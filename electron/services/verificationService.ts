// electron/services/verificationService.ts
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'

// ── Types ─────────────────────────────────────────────────────────────────────

export type VerificationTier = 'verified' | 'likely' | null

export interface ScoreInput {
  owner:             string
  name:              string
  homepage:          string | null
  owner_is_verified: number | null
  watchers:          number | null
  registryMatch:     boolean
}

export interface ScoreResult {
  score:   number
  tier:    VerificationTier
  signals: string[]
}

// repoId is a string (TEXT PRIMARY KEY) — e.g. "facebook/react"
export type EnrichmentJob = {
  repoId:   string
  owner:    string
  name:     string
  language: string | null
  priority: 'high' | 'normal' | 'low'
}

// ── Score computation ─────────────────────────────────────────────────────────

export function computeScore(input: ScoreInput): ScoreResult {
  const signals: string[] = []
  let score = 0

  // +40 registry match
  if (input.registryMatch) {
    signals.push('registry_match')
    score += 40
  }

  // +25 verified org (owner_is_verified = 1)
  if (input.owner_is_verified === 1) {
    signals.push('verified_org')
    score += 25
  }

  // +20 homepage domain match
  if (input.homepage) {
    try {
      const domain = new URL(input.homepage).hostname.replace(/^www\./, '')
      const ownerL = input.owner.toLowerCase()
      const nameL  = input.name.toLowerCase()
      if (domain.includes(ownerL) || domain.includes(nameL)) {
        signals.push('homepage_match')
        score += 20
      }
    } catch {
      // invalid URL — skip
    }
  }

  // +10 self-named repo (e.g. django/django)
  if (input.owner.toLowerCase() === input.name.toLowerCase()) {
    signals.push('self_named')
    score += 10
  }

  // +5–15 dependent tier proxy (watchers/subscribers_count)
  const w = input.watchers ?? 0
  if (w >= 1000) {
    signals.push('dependent_tier')
    score += 15
  } else if (w >= 100) {
    signals.push('dependent_tier')
    score += 10
  } else if (w >= 10) {
    signals.push('dependent_tier')
    score += 5
  }

  const tier: VerificationTier =
    score >= 70 ? 'verified' :
    score >= 40 ? 'likely'   :
    null

  return { score, tier, signals }
}

// ── Registry fetchers ─────────────────────────────────────────────────────────

export async function checkNpm(pkgName: string, owner: string): Promise<boolean> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}`)
    if (!res.ok) return false
    const data = await res.json() as { maintainers?: { name: string }[]; repository?: { url?: string } }
    const ownerL = owner.toLowerCase()
    if (data.maintainers?.some(m => m.name.toLowerCase().includes(ownerL))) return true
    if (data.repository?.url?.toLowerCase().includes(ownerL)) return true
    return false
  } catch {
    return false
  }
}

export async function checkPypi(pkgName: string, owner: string): Promise<boolean> {
  try {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkgName)}/json`)
    if (!res.ok) return false
    const data = await res.json() as { info?: { author?: string; home_page?: string } }
    const ownerL = owner.toLowerCase()
    if (data.info?.author?.toLowerCase().includes(ownerL)) return true
    if (data.info?.home_page?.toLowerCase().includes(ownerL)) return true
    return false
  } catch {
    return false
  }
}

export async function checkCrates(pkgName: string, owner: string): Promise<boolean> {
  try {
    const res = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(pkgName)}`, {
      headers: { 'User-Agent': 'gitplaces-app/1.0' },
    })
    if (!res.ok) return false
    const data = await res.json() as { crate?: { repository?: string } }
    return data.crate?.repository?.toLowerCase().includes(owner.toLowerCase()) ?? false
  } catch {
    return false
  }
}

// ── Language → registry routing ───────────────────────────────────────────────

export async function fetchRegistryMatch(
  name: string,
  owner: string,
  language: string | null,
): Promise<boolean> {
  const lang = (language ?? '').toLowerCase()
  if (lang === 'javascript' || lang === 'typescript') {
    return checkNpm(name.toLowerCase(), owner)
  }
  if (lang === 'python') {
    return checkPypi(name.toLowerCase(), owner)
  }
  if (lang === 'rust') {
    return checkCrates(name.toLowerCase(), owner)
  }
  return false
}

// ── Priority queue ────────────────────────────────────────────────────────────

const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 } as const

export function buildQueue() {
  const items: EnrichmentJob[] = []

  return {
    push(job: EnrichmentJob) {
      const existingIdx = items.findIndex(j => j.repoId === job.repoId)
      if (existingIdx !== -1) {
        // Keep highest priority (lowest order number)
        if (PRIORITY_ORDER[job.priority] < PRIORITY_ORDER[items[existingIdx].priority]) {
          items[existingIdx] = job
          items.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
        }
        return
      }
      items.push(job)
      items.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    },
    shift(): EnrichmentJob | undefined {
      return items.shift()
    },
    size(): number {
      return items.length
    },
  }
}

// ── Last-request timestamps per registry (rate limiting) ──────────────────────

const lastRegistryCall: Record<string, number> = {}

async function rateLimit(registry: string): Promise<void> {
  const MIN_GAP_MS = 300
  const now = Date.now()
  const last = lastRegistryCall[registry] ?? 0
  const wait = MIN_GAP_MS - (now - last)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastRegistryCall[registry] = Date.now()
}

async function fetchRegistryMatchRateLimited(
  name: string,
  owner: string,
  language: string | null,
): Promise<boolean> {
  const lang = (language ?? '').toLowerCase()
  if (lang === 'javascript' || lang === 'typescript') {
    await rateLimit('npm')
    return checkNpm(name.toLowerCase(), owner)
  }
  if (lang === 'python') {
    await rateLimit('pypi')
    return checkPypi(name.toLowerCase(), owner)
  }
  if (lang === 'rust') {
    await rateLimit('crates')
    return checkCrates(name.toLowerCase(), owner)
  }
  return false
}

// ── Service state ─────────────────────────────────────────────────────────────

let _db: Database.Database | null = null
let _mainWindow: BrowserWindow | null = null
const queue = buildQueue()
let running = false

export function enqueueRepo(job: EnrichmentJob): void {
  queue.push(job)
  processNext()
}

async function processJob(job: EnrichmentJob): Promise<void> {
  if (!_db) return

  try {
    const registryMatch = await fetchRegistryMatchRateLimited(job.name, job.owner, job.language)

    // Fetch supplemental signals not in the job (stored as TEXT PRIMARY KEY id)
    const row = _db.prepare(
      'SELECT owner_is_verified, homepage, watchers FROM repos WHERE id = ?'
    ).get(job.repoId) as { owner_is_verified: number | null; homepage: string | null; watchers: number | null } | undefined

    const { score, tier, signals } = computeScore({
      owner:             job.owner,
      name:              job.name,
      homepage:          row?.homepage ?? null,
      owner_is_verified: row?.owner_is_verified ?? null,
      watchers:          row?.watchers ?? null,
      registryMatch,
    })

    const now = Math.floor(Date.now() / 1000)
    _db.prepare(`
      UPDATE repos
      SET verification_score      = ?,
          verification_tier       = ?,
          verification_signals    = ?,
          verification_checked_at = ?
      WHERE id = ?
    `).run(score, tier, JSON.stringify(signals), now, job.repoId)

    _mainWindow?.webContents.send('verification:updated', {
      repoId:  job.repoId,
      tier,
      signals,
    })
  } catch (err) {
    console.error('[verificationService] job failed', job.repoId, err)
    // Network failure: mark as checked (no retry), clear tier/signals, set score 0
    const now = Math.floor(Date.now() / 1000)
    try {
      _db?.prepare(
        'UPDATE repos SET verification_score = 0, verification_tier = NULL, verification_signals = NULL, verification_checked_at = ? WHERE id = ?'
      ).run(now, job.repoId)
    } catch {}
  }
}

async function processNext(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.size() > 0) {
      // Take up to 3 concurrent jobs
      const batch: EnrichmentJob[] = []
      while (batch.length < 3 && queue.size() > 0) {
        batch.push(queue.shift()!)
      }
      await Promise.all(batch.map(processJob))
    }
  } finally {
    running = false
    // Tail-recursive drain: items enqueued while the loop was running are caught here
    if (queue.size() > 0) void processNext()
  }
}

export function startVerificationService(db: Database.Database, win: BrowserWindow): void {
  _db = db
  _mainWindow = win

  const SEVEN_DAYS_AGO = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60

  // Enqueue unchecked repos (normal priority)
  const unchecked = db.prepare(
    'SELECT id, owner, name, language FROM repos WHERE verification_checked_at IS NULL'
  ).all() as { id: string; owner: string; name: string; language: string | null }[]

  for (const r of unchecked) {
    queue.push({ repoId: r.id, owner: r.owner, name: r.name, language: r.language, priority: 'normal' })
  }

  // Enqueue stale repos older than 7 days (low priority)
  const stale = db.prepare(
    'SELECT id, owner, name, language FROM repos WHERE verification_checked_at IS NOT NULL AND verification_checked_at < ?'
  ).all(SEVEN_DAYS_AGO) as { id: string; owner: string; name: string; language: string | null }[]

  for (const r of stale) {
    queue.push({ repoId: r.id, owner: r.owner, name: r.name, language: r.language, priority: 'low' })
  }

  if (queue.size() > 0) processNext()
}

export function prioritiseRepos(repoIds: string[]): void {
  if (!_db) return
  const STALE_MS = 7 * 24 * 60 * 60 // 7 days in seconds
  const nowSec = Math.floor(Date.now() / 1000)
  for (const id of repoIds) {
    const row = _db.prepare(
      'SELECT id, owner, name, language, verification_checked_at FROM repos WHERE id = ?'
    ).get(id) as { id: string; owner: string; name: string; language: string | null; verification_checked_at: number | null } | undefined
    if (!row) continue
    // Skip repos already checked within the stale window — the result is
    // cached in the DB and the frontend will read it via getBatchScores.
    const checkedAt = row.verification_checked_at
    if (checkedAt && (nowSec - checkedAt) < STALE_MS) continue
    queue.push({ repoId: row.id, owner: row.owner, name: row.name, language: row.language, priority: 'high' })
  }
  processNext()
}
