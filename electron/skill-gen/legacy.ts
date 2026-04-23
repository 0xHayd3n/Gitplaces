import Anthropic from '@anthropic-ai/sdk'
import { spawn, execFile } from 'child_process'
import { existsSync } from 'fs'
import * as path from 'path'

export interface SkillGenInput {
  owner: string
  name: string
  language: string
  topics: string[]
  readme: string       // raw markdown, may be empty string
  version: string      // from latest release tag, or 'unknown'
  isComponents?: boolean
  enabledComponents?: string[]
  enabledTools?: string[]
  scannedComponents?: { name: string; props: { name: string; type: string; required: boolean; defaultValue?: string }[] }[]
}

const TOOLS_PROMPT_APPEND = (names: string) =>
  `\n\nScope this skill to only these MCP tools: ${names}. ` +
  `Omit documentation for any tool not in this list. Focus sections on the subset's workflow.`

const COMPONENT_PROMPT_APPEND = (list: string) => `

This is a component library. Generate documentation ONLY for these enabled components: ${list}.
For each component, include:
- Import statement
- Props interface (key props only)
- 1–2 usage examples
Organise by category using #### headings (Form & Input, Overlay & Feedback, Navigation & Layout).
Use ### ComponentName for each component heading.
Do not use ## headings for components or categories — only #### and ### to avoid conflicting with the depth section markers.`

function buildPrompt(input: SkillGenInput): string {
  const readmeTruncated = input.readme.slice(0, 12000)
  const componentSuffix =
    input.isComponents && input.enabledComponents && input.enabledComponents.length > 0
      ? COMPONENT_PROMPT_APPEND(input.enabledComponents.join(', '))
      : input.enabledTools && input.enabledTools.length > 0
        ? TOOLS_PROMPT_APPEND(input.enabledTools.join(', '))
        : ''

  return `Generate a skill file for the GitHub repository "${input.owner}/${input.name}".

Language: ${input.language}
Topics: ${input.topics.join(', ')}
Version: ${input.version}

README:
${readmeTruncated}

Produce a skill.md file with exactly three depth sections.

SECTION MARKER FORMAT — follow exactly:
✅ CORRECT: ## [CORE]
❌ WRONG:  ## [CORE] Some Title Here
The marker must be the ONLY text on its line. No title, no description, nothing after the closing bracket.

## [CORE]
Maximum 80 lines. Start with a structured frontmatter block in a fenced code block, then the most critical usage patterns.

The FIRST thing after ## [CORE] must be this fenced code block (fill in the install command):

\`\`\`
repo: ${input.owner}/${input.name}
version: ${input.version}
language: ${input.language}
install: <package manager install command from the README>
requires: <runtime version and peer dependencies, e.g. "node>=18, react>=17">
\`\`\`

After the frontmatter, include:
- If this is a library/SDK (not a CLI tool): primary import paths and any known import gotchas (correct vs incorrect import examples)
- The 3 most common usage patterns with brief code examples
- Critical gotchas — prefer "wrong way / right way" pairs where applicable
- Any model reading only this section should be able to immediately use the library correctly

## [EXTENDED]
Maximum 120 additional lines. Include:
- Secondary API surface and less common patterns
- Configuration options with defaults noted
- Integration tips with other libraries/frameworks
- Common errors and their fixes (format: "Error: <message>" → cause → fix)
- A "### When NOT to use" subsection (REQUIRED) — list anti-patterns, wrong-tool-for-the-job scenarios, and common misuses

## [DEEP]
Maximum 200 additional lines. Include:
- Edge cases and advanced configuration
- Performance considerations and benchmarks if documented
- Migration guides between versions if documented
- Known issues or limitations
- Internals useful for debugging

Rules:
- Write for an AI coding assistant as the reader, not a human — optimise for fast, accurate code generation
- Be dense and precise — no conversational filler, no "This library is great for…" prose
- Prefer short code examples over prose descriptions — show, don't tell
- Each section must be independently useful if read alone
- Do not reproduce licence text, contributor lists, or changelog entries
- Do not include URLs unless they appear verbatim in the README. Do not guess or construct URLs.
- CRITICAL: Only include information that is present in or clearly implied by the README above — do not invent CLI commands, APIs, configuration options, function signatures, parameters, or URLs that are not documented. If unsure whether something exists, omit it. When in doubt, leave it out.
- Start immediately with ## [CORE] on its own line — no preamble, no title, nothing after the marker
- Do not use any tools — all necessary information is provided above. Output the skill file text directly.${componentSuffix}`
}

function formatScannedComponents(components: NonNullable<SkillGenInput['scannedComponents']>): string {
  return components.map(c => {
    if (c.props.length === 0) return `- ${c.name}: (no props extracted)`
    const propList = c.props.map(p => {
      let desc = `${p.name} (${p.type}, ${p.required ? 'required' : 'optional'}`
      if (p.defaultValue !== undefined) desc += `, default: ${p.defaultValue}`
      desc += ')'
      return desc
    }).join(', ')
    return `- ${c.name}: ${propList}`
  }).join('\n')
}

function buildComponentsPrompt(input: SkillGenInput): string {
  const readmeTruncated = input.readme.slice(0, 12000)
  const hasScanned = input.scannedComponents && input.scannedComponents.length > 0

  let componentSection: string
  if (hasScanned) {
    // When user has selected specific components, filter scanned data to match
    const filtered = input.enabledComponents?.length
      ? input.scannedComponents!.filter(c => input.enabledComponents!.includes(c.name))
      : input.scannedComponents!
    const scannedBlock = formatScannedComponents(filtered.length > 0 ? filtered : input.scannedComponents!)
    componentSection = `SCANNED COMPONENTS (from source code analysis):
${scannedBlock}

Document all components listed above. Use the README for general context (package name, import paths, design system) and the scanned data for component names and props.`
  } else {
    componentSection = input.enabledComponents && input.enabledComponents.length > 0
      ? `Only document these components: ${input.enabledComponents.join(', ')}.`
      : 'Document all components you can identify from the README.'
  }

  return `Generate a components skill file for the GitHub repository "${input.owner}/${input.name}".

Language: ${input.language}
Version: ${input.version}

README:
${readmeTruncated}

${componentSection}

Produce a components.skill.md file using this exact format:

## [COMPONENTS]

One sentence describing what this component library provides and its design system (e.g. Material Design, Radix primitives, headless, etc.).

Then for each component, use this structure:

### ComponentName
**Import:** \`import { ComponentName } from 'package-name'\`
**Props:** (list key props as: \`propName\` — type — default — description)
**Variants:** variant1 | variant2 | variant3 (omit if not applicable)
**Example:**
\`\`\`tsx
<ComponentName prop="value" onEvent={handler} />
\`\`\`
**Gotcha:** one-line gotcha if there is a common mistake (omit if none)

---

Rules:
- Write for an AI coding assistant — optimise for fast, accurate component usage
- Include ONLY components documented in the README or listed in the scanned data above — do not invent components
- Key props only (3–6 per component) — skip internal/rarely-used props
- Prefer real prop names from the scanned data or README over guessed names
- Do not include URLs unless they appear verbatim in the README
- Group related components under a #### Category heading (e.g. #### Form & Input)
- Start immediately with ## [COMPONENTS] on its own line — no preamble
- Do not use any tools — output the skill file text directly.`
}

// ── Post-processing: strip hallucinated URLs ─────────────────────

/**
 * Extract all URLs from a string (both bare and inside markdown links).
 * Returns a Set of normalised URL strings for fast lookup.
 */
function extractUrls(text: string): Set<string> {
  const urls = new Set<string>()
  // Match http(s) URLs — captures bare URLs and those inside markdown [text](url)
  const re = /https?:\/\/[^\s)\]>"'`]+/gi
  for (const m of text.matchAll(re)) {
    // Normalise: strip trailing punctuation that's likely not part of the URL
    urls.add(m[0].replace(/[.,;:!?)]+$/, ''))
  }
  return urls
}

/**
 * Remove URLs from `content` that don't appear in `readme`.
 * Handles:
 *   - Markdown links:  [text](https://…)  →  text
 *   - Bare URLs:       https://…           →  (removed)
 *   - Reference-style "documented at <url>" prose  →  cleaned
 */
function stripHallucinatedUrls(content: string, readme: string): string {
  const allowedUrls = extractUrls(readme)

  // Also always allow github.com/<owner>/<name> clone URLs since we provide those in input
  // (the model naturally generates `git clone` examples)

  const isAllowed = (url: string): boolean => {
    const clean = url.replace(/[.,;:!?)]+$/, '')
    // Exact match
    if (allowedUrls.has(clean)) return true
    // Allow if any allowed URL is a prefix (e.g. readme has "https://docs.x.io" and model wrote "https://docs.x.io/setup")
    for (const allowed of allowedUrls) {
      if (clean.startsWith(allowed)) return true
    }
    return false
  }

  let result = content

  // 1. Replace markdown links [text](url) → keep text if URL not allowed
  result = result.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_match, text, url) => {
    return isAllowed(url) ? _match : text
  })

  // 2. Remove bare URLs on their own or in prose (but not inside code fences)
  //    We process line by line, skipping fenced code blocks
  const lines = result.split('\n')
  let inCodeFence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) { inCodeFence = !inCodeFence; continue }
    if (inCodeFence) continue

    // Replace bare URLs that aren't allowed
    lines[i] = lines[i].replace(/https?:\/\/[^\s)\]>"'`]+/g, (url) => {
      return isAllowed(url) ? url : ''
    })

    // Clean up leftover artefacts like "Reference: " or "documented at " with nothing after
    lines[i] = lines[i]
      .replace(/\bReference:\s*$/i, '')
      .replace(/\bdocumented at\s*$/i, '')
      .replace(/\bsee\s*$/i, '')
      .replace(/\bin docs\s*$/i, '')
  }

  return lines.join('\n')
    // Collapse multiple blank lines into max 2
    .replace(/\n{3,}/g, '\n\n')
}

// ── Claude Code CLI subprocess ────────────────────────────────────

/**
 * Build an env object with augmented PATH so that globally-installed npm
 * binaries (like `claude`) can be found even when Electron's inherited PATH
 * is missing the user npm bin directory.
 */
export function buildEnv(omitApiKey = false): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (omitApiKey) delete env['ANTHROPIC_API_KEY']

  const sep = process.platform === 'win32' ? ';' : ':'
  const extra: string[] = []

  if (process.platform === 'win32') {
    // npm global bin on Windows: %APPDATA%\npm
    if (env.APPDATA)      extra.push(`${env.APPDATA}\\npm`)
    if (env.LOCALAPPDATA) extra.push(`${env.LOCALAPPDATA}\\Programs\\nodejs`)
  } else {
    // Common locations on macOS / Linux
    extra.push('/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin')
    if (env.HOME) {
      extra.push(`${env.HOME}/.npm-global/bin`)
      extra.push(`${env.HOME}/.nvm/current/bin`)
      extra.push(`${env.HOME}/.volta/bin`)
    }
  }

  if (extra.length > 0) {
    env.PATH = extra.join(sep) + sep + (env.PATH ?? '')
  }

  return env
}

/** Scan PATH directories directly for the claude binary. */
function scanPathForClaude(): string | null {
  const sep = process.platform === 'win32' ? ';' : ':'
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : ['']
  const dirs = (buildEnv().PATH ?? '').split(sep).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `claude${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * On Windows, PowerShell Get-Command reads PATH from the registry so it finds
 * binaries even when Electron's inherited PATH is incomplete.
 */
function findClaudeViaPowerShell(): Promise<string | null> {
  return new Promise((resolve) => {
    // Use SystemRoot to get the absolute path to powershell.exe
    const ps = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
    )
    const proc = spawn(ps, [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Command claude -ErrorAction SilentlyContinue).Source',
    ], { stdio: ['ignore', 'pipe', 'ignore'] })

    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('error', () => resolve(null))
    proc.on('close', () => {
      const result = out.trim()
      console.log(`[skill-gen] PowerShell Get-Command claude: "${result}"`)
      resolve(result || null)
    })
  })
}

// Cache the resolved paths so we only search once per session
let _claudePathCache: string | null | undefined = undefined
let _npmPathCache: string | null | undefined = undefined

export function invalidateClaudePathCache() {
  _claudePathCache = undefined
}

export async function findClaude(): Promise<string | null> {
  if (_claudePathCache !== undefined) return _claudePathCache

  // 1. Fast PATH scan
  const fromScan = scanPathForClaude()
  if (fromScan) {
    console.log(`[skill-gen] found claude via PATH scan: ${fromScan}`)
    _claudePathCache = fromScan
    return fromScan
  }

  // 2. Windows: ask PowerShell (reads registry PATH, not just inherited env)
  if (process.platform === 'win32') {
    const fromPs = await findClaudeViaPowerShell()
    if (fromPs) {
      _claudePathCache = fromPs
      return fromPs
    }
  }

  console.log('[skill-gen] claude not found')
  _claudePathCache = null
  return null
}

/** Resolve the local cli.js path from node_modules — this is what we actually use. */
export function findLocalCli(): string | null {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

/**
 * True if we have both the local cli.js AND a node binary to run it with.
 * This is the real prerequisite for skill generation.
 */
export async function detectClaudeCode(): Promise<boolean> {
  if (!findLocalCli()) return false
  return (await findNode()) !== null
}

/**
 * Run `node cli.js auth status --json` and return whether the user is logged in.
 * Always reads fresh from disk — safe to call after completing auth login.
 */
export async function checkAuthStatus(): Promise<boolean> {
  const nodePath = await findNode()
  if (!nodePath) return false

  const cliPath = findLocalCli()
  if (!cliPath) return false

  return new Promise((resolve) => {
    execFile(nodePath, [cliPath, 'auth', 'status', '--json'], {
      env: buildEnv(true),
      timeout: 10_000,
    }, (err, stdout) => {
      if (err) { resolve(false); return }
      try {
        const result = JSON.parse(stdout) as { loggedIn?: boolean }
        resolve(result.loggedIn === true)
      } catch { resolve(false) }
    })
  })
}

// ── npm detection ─────────────────────────────────────────────────

function scanPathForNpm(): string | null {
  const sep = process.platform === 'win32' ? ';' : ':'
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : ['']
  const dirs = (buildEnv().PATH ?? '').split(sep).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `npm${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function findNpmViaPowerShell(): Promise<string | null> {
  return new Promise((resolve) => {
    const ps = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
    )
    const proc = spawn(ps, [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Command npm -ErrorAction SilentlyContinue).Source',
    ], { stdio: ['ignore', 'pipe', 'ignore'] })

    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('error', () => resolve(null))
    proc.on('close', () => resolve(out.trim() || null))
  })
}

function findNodeViaPowerShell(): Promise<string | null> {
  return new Promise((resolve) => {
    const ps = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
    )
    const proc = spawn(ps, [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Command node -ErrorAction SilentlyContinue).Source',
    ], { stdio: ['ignore', 'pipe', 'ignore'] })

    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('error', () => resolve(null))
    proc.on('close', () => resolve(out.trim() || null))
  })
}

export async function findNpm(): Promise<string | null> {
  if (_npmPathCache !== undefined) return _npmPathCache

  const fromScan = scanPathForNpm()
  if (fromScan) { _npmPathCache = fromScan; return fromScan }

  if (process.platform === 'win32') {
    const fromPs = await findNpmViaPowerShell()
    if (fromPs) { _npmPathCache = fromPs; return fromPs }
  }

  _npmPathCache = null
  return null
}

let _nodePathCache: string | null | undefined = undefined

export async function findNode(): Promise<string | null> {
  if (_nodePathCache !== undefined) return _nodePathCache

  // If process.execPath is not Electron (e.g. running tests), it IS node
  if (!process.execPath.toLowerCase().includes('electron')) {
    _nodePathCache = process.execPath
    return process.execPath
  }

  // Scan augmented PATH for node binary
  const sep = process.platform === 'win32' ? ';' : ':'
  const exts = process.platform === 'win32' ? ['.exe', ''] : ['']
  const dirs = (buildEnv().PATH ?? '').split(sep).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `node${ext}`)
      if (existsSync(candidate)) {
        _nodePathCache = candidate
        return candidate
      }
    }
  }

  // Windows: PowerShell reads registry PATH — finds node even when Electron can't
  if (process.platform === 'win32') {
    const fromPs = await findNodeViaPowerShell()
    if (fromPs) { _nodePathCache = fromPs; return fromPs }
  }

  _nodePathCache = null
  return null
}

// ── Claude Code login ─────────────────────────────────────────────

export interface LoginHandle {
  /** Write the browser-provided auth code to the CLI's stdin and complete login. */
  submitCode: (code: string) => void
  /** Resolves when login succeeds; rejects on error. */
  done: Promise<void>
}

/**
 * Start the Claude Code `auth login` flow.
 *
 * The CLI opens a browser for OAuth then waits for the auth code on stdin.
 * Returns a `LoginHandle` so the caller can pipe the code in later.
 *
 * Always uses `node cli.js` directly — avoids the global .ps1/.cmd wrapper
 * which misbehaves when spawned from Electron's main process.
 */
export async function loginClaude(onProgress: (msg: string) => void): Promise<LoginHandle> {
  const nodePath = await findNode()
  if (!nodePath) throw new Error('Node.js not found. Please install Node.js first.')

  const cliPath = findLocalCli()
  if (!cliPath) throw new Error('Claude Code CLI not found in node_modules.')

  // If already logged in, short-circuit
  const alreadyLoggedIn = await checkAuthStatus().catch(() => false)
  if (alreadyLoggedIn) {
    onProgress('Already logged in!')
    return { submitCode: () => {}, done: Promise.resolve() }
  }

  console.log(`[skill-gen] loginClaude: node=${nodePath} cli=${cliPath}`)
  onProgress('Opening browser for Claude login…')

  const proc = spawn(nodePath, [cliPath, 'auth', 'login', '--claudeai'], {
    stdio: ['pipe', 'pipe', 'pipe'], // stdin is pipe so we can write the auth code
    env: buildEnv(true),
  })

  const handleLine = (d: Buffer) => {
    d.toString().split(/\r?\n/).filter(Boolean).forEach((line) => {
      console.log(`[skill-gen] login output: ${line}`)
      onProgress(line)
    })
  }
  proc.stdout.on('data', handleLine)
  proc.stderr.on('data', handleLine)

  let settled = false
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let resolveLogin!: () => void
  let rejectLogin!: (e: Error) => void

  const done = new Promise<void>((res, rej) => { resolveLogin = res; rejectLogin = rej })

  const settle = (fn: () => void) => {
    if (settled) return
    settled = true
    if (pollTimer) clearInterval(pollTimer)
    fn()
  }

  const startPolling = () => {
    if (pollTimer) return // already polling
    console.log('[skill-gen] Starting auth status polling…')
    let ticks = 0
    pollTimer = setInterval(async () => {
      ticks++
      if (ticks % 10 === 0 && !settled) onProgress('Still verifying authentication…')
      console.log('[skill-gen] Polling auth status…')
      const ok = await checkAuthStatus().catch(() => false)
      console.log(`[skill-gen] Auth status poll result: ${ok}`)
      if (ok) {
        try { proc.kill() } catch { /* process may already be dead */ }
        settle(resolveLogin)
      }
    }, 2000)
  }

  const timeoutId = setTimeout(() => {
    try { proc.kill() } catch { /* ignore */ }
    settle(() => rejectLogin(new Error('Login timed out. Please try again.')))
  }, 3 * 60 * 1000)

  proc.on('error', (err) => {
    clearTimeout(timeoutId)
    settle(() => rejectLogin(new Error(`Failed to start login: ${err.message}`)))
  })

  proc.on('close', async (code) => {
    console.log(`[skill-gen] Login process exited with code ${code}`)
    clearTimeout(timeoutId)
    if (settled) return

    // The CLI may exit before credentials are fully flushed to disk.
    // Retry auth check with delays to give the filesystem time to sync.
    for (const delay of [500, 1500, 3000]) {
      await new Promise(r => setTimeout(r, delay))
      const ok = await checkAuthStatus().catch(() => false)
      console.log(`[skill-gen] Post-exit auth check (after ${delay}ms): ${ok}`)
      if (ok) { settle(resolveLogin); return }
    }

    if (code === 0) {
      // Process exited cleanly — maybe auth succeeded but status check failed
      // (e.g. credentials stored in a location checkAuthStatus doesn't see)
      settle(() => rejectLogin(new Error(
        'Login process completed but auth could not be confirmed. ' +
        'This may mean login succeeded — please close and re-open Settings to check.'
      )))
    } else {
      settle(() => rejectLogin(new Error(`Login failed (exit code ${code}). Please try again.`)))
    }
  })

  const submitCode = (code: string) => {
    console.log(`[skill-gen] Submitting auth code (${code.length} chars)…`)
    if (proc.stdin.writable) {
      onProgress('Verifying code with Claude…')
      proc.stdin.write(code.trim() + '\n', 'utf8')
      // Don't call stdin.end() immediately on Windows — the CLI may need the
      // pipe to stay open briefly while it processes the code. Instead, end it
      // after a short delay to ensure the data is flushed and read.
      setTimeout(() => {
        try { proc.stdin.end() } catch { /* already closed */ }
      }, 500)
    }
    startPolling() // start checking auth status every 2s
  }

  return { submitCode, done }
}

export async function logoutClaude(): Promise<void> {
  const nodePath = await findNode()
  if (!nodePath) return
  const cliPath = findLocalCli()
  if (!cliPath) return
  await new Promise<void>((resolve) => {
    const proc = spawn(nodePath, [cliPath, 'auth', 'logout'], {
      stdio: 'ignore',
      env: buildEnv(true),
    })
    const done = () => resolve()
    proc.on('close', done)
    proc.on('error', done)
    setTimeout(() => { try { proc.kill() } catch { /* already dead */ } resolve() }, 5000)
  })
}

// ── Claude Code install + auth ────────────────────────────────────

export async function installClaudeCLI(onProgress: (line: string) => void): Promise<void> {
  const npmPath = await findNpm()
  if (!npmPath) throw new Error('npm not found — please install Node.js first')

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      npmPath,
      ['install', '-g', '@anthropic-ai/claude-code'],
      {
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildEnv(),
      }
    )

    const handleLine = (data: Buffer) => {
      data.toString().split(/\r?\n/).filter(Boolean).forEach(onProgress)
    }

    proc.stdout.on('data', handleLine)
    proc.stderr.on('data', handleLine)
    proc.on('error', (err) => reject(new Error(`Failed to run npm: ${err.message}`)))
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`npm install exited with code ${code}`))
      } else {
        resolve()
      }
    })
  })
}

export async function triggerClaudeAuth(): Promise<void> {
  // Invalidate cache first — we just installed, so the cached null is stale
  invalidateClaudePathCache()
  const claudePath = (await findClaude()) ?? 'claude'

  await new Promise<void>((resolve, reject) => {
    // Run `claude --version` first to trigger the auth/login flow;
    // Claude Code opens the browser on first run.
    const proc = spawn(
      claudePath,
      ['--version'],
      {
        shell: process.platform === 'win32',
        stdio: 'ignore',
        env: buildEnv(true),
      }
    )
    proc.on('error', (err) => reject(new Error(`Failed to launch claude: ${err.message}`)))
    proc.on('close', () => resolve())
  })
}

/**
 * Lower-level generation function that accepts a pre-built prompt string.
 * Used by the new pipeline to supply type-specific prompts while reusing
 * the existing CLI spawn / API fallback logic.
 */
export async function generateWithRawPrompt(
  prompt: string,
  readme: string,
  options?: { model?: string; maxTokens?: number; apiKey?: string }
): Promise<string> {
  const model = options?.model ?? 'claude-haiku-4-5'
  const maxTokens = options?.maxTokens ?? 3072

  const nodePath = await findNode()
  if (!nodePath) {
    // Fall back to Anthropic SDK API if no Node available
    if (!options?.apiKey) throw new Error('Node.js not found and no API key provided')
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: options.apiKey })
    const response = await client.messages.create({
      model, max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = response.content[0].type === 'text' ? response.content[0].text : ''
    return stripHallucinatedUrls(raw, readme)
  }

  const cliPath = findLocalCli()
  if (!cliPath) throw new Error('Claude Code not found in node_modules. Run npm install.')

  console.log(`[skill-gen] generateWithRawPrompt: node=${nodePath} cli=${cliPath} model=${model}`)

  return new Promise((resolve, reject) => {
    const proc = spawn(
      nodePath,
      [cliPath, '--print', '--output-format', 'json', '--max-turns', '3', '--model', model],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: buildEnv(true),
      }
    )

    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk))

    proc.on('error', (err) => reject(new Error(`Failed to spawn node: ${err.message}`)))

    proc.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf8')
      const stderr = Buffer.concat(errChunks).toString('utf8')

      let parsed: { result?: string; is_error?: boolean } | null = null
      try { parsed = JSON.parse(stdout) } catch { /* not JSON */ }

      if (parsed !== null) {
        if (parsed.is_error) {
          const msg = parsed.result ?? 'unknown error'
          console.error(`[skill-gen] CLI stdout: ${stdout.slice(0, 500)}`)
          if (/not logged in|login/i.test(msg)) {
            reject(new Error('Claude Code is not logged in. Run `claude login` in a terminal, then try again.'))
          } else {
            reject(new Error(`Claude CLI error: ${msg.slice(0, 300)}`))
          }
          return
        }
        const result = parsed.result ?? ''
        if (!result.trim()) {
          const subtype = (parsed as Record<string, unknown>).subtype ?? 'unknown'
          console.error(`[skill-gen] Empty result from CLI (subtype=${subtype}): ${stdout.slice(0, 500)}`)
          reject(new Error('Skill generation returned empty content. Please try again.'))
          return
        }
        resolve(stripHallucinatedUrls(result, readme))
        return
      }

      if (code !== 0) {
        const detail = stderr || stdout || '(no output)'
        console.error(`[skill-gen] CLI stdout: ${stdout.slice(0, 500)}`)
        console.error(`[skill-gen] CLI stderr: ${stderr.slice(0, 500)}`)
        reject(new Error(`Claude CLI exited with code ${code}: ${detail.slice(0, 400)}`))
        return
      }

      resolve(stripHallucinatedUrls(stdout.trim(), readme))
    })

    proc.stdin.write(prompt, 'utf8')
    proc.stdin.end()
  })
}

export async function generateSkillViaLocalCLI(input: SkillGenInput): Promise<string> {
  return generateWithRawPrompt(buildPrompt(input), input.readme)
}

export async function generateComponentsSkillViaLocalCLI(input: SkillGenInput): Promise<string> {
  return generateWithRawPrompt(buildComponentsPrompt(input), input.readme)
}

// ── Anthropic API key fallback ────────────────────────────────────

export async function generateSkill(input: SkillGenInput, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    messages: [{ role: 'user', content: buildPrompt(input) }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  return stripHallucinatedUrls(raw, input.readme)
}

export async function generateComponentsSkill(input: SkillGenInput, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: buildComponentsPrompt(input) }],
  })
  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  return stripHallucinatedUrls(raw, input.readme)
}
