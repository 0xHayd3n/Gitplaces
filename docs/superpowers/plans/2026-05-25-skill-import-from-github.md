# Skill Import From GitHub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third entry path to `ImportSkillDialog`: paste a GitHub repo URL, fetch its skills, import selected ones into the agents library using the existing `importSkill` pipeline.

**Architecture:** A pure URL parser in `src/utils/`, a new main-process service in `electron/services/` that walks a GitHub repo via the existing `electron/github.ts` helpers, two new IPC routes under `agents:import:*`, and a new section in `ImportSkillDialog.tsx` below the plugin list. No DB schema changes — existing `origin_*` columns store the GitHub provenance.

**Tech Stack:** TypeScript, React, Electron IPC, Vitest + @testing-library/react, `gray-matter` (already a dep).

**Spec:** [docs/superpowers/specs/2026-05-25-skill-import-from-github-design.md](../specs/2026-05-25-skill-import-from-github-design.md)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/parseGithubRepoUrl.ts` | Create | Pure URL parser. Returns `{ owner, name } \| null`. |
| `src/utils/parseGithubRepoUrl.test.ts` | Create | Parser tests — accepted forms + rejected forms. |
| `electron/services/skillImportFromGithubService.ts` | Create | `discoverSkillsInRepo`, `readSkillFromRepo`, error types. |
| `electron/services/skillImportFromGithubService.test.ts` | Create | Tests with mocked `electron/github.ts` exports. |
| `electron/ipc/agentHandlers.ts` | Modify | Two new IPC handlers — `agents:import:discoverInRepo`, `agents:import:readSkillFromRepo`. |
| `electron/preload.ts` | Modify | Two new entries under `agents.import.*`. |
| `src/env.d.ts` | Modify | Ambient types for the two new methods. |
| `src/components/ImportSkillDialog.tsx` | Modify | New GitHub section with URL input, Fetch button, skill list, Import button. |
| `src/components/ImportSkillDialog.test.tsx` | Modify | Tests for the new section. |
| `src/views/AgentDetail.css` | Modify | CSS for the new section, reusing existing `.import-skill-*` tokens. |

---

## Phase 1: URL parser

### Task 1: `parseGithubRepoUrl`

**Files:**
- Create: `src/utils/parseGithubRepoUrl.ts`
- Create: `src/utils/parseGithubRepoUrl.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/utils/parseGithubRepoUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseGithubRepoUrl } from './parseGithubRepoUrl'

describe('parseGithubRepoUrl — accepts', () => {
  it.each<[string, { owner: string; name: string }]>([
    ['owner/repo',                                  { owner: 'owner', name: 'repo' }],
    ['https://github.com/owner/repo',               { owner: 'owner', name: 'repo' }],
    ['https://github.com/owner/repo.git',           { owner: 'owner', name: 'repo' }],
    ['https://github.com/owner/repo/',              { owner: 'owner', name: 'repo' }],
    ['http://github.com/owner/repo',                { owner: 'owner', name: 'repo' }],
    ['HTTPS://GITHUB.COM/Owner/Repo',               { owner: 'Owner', name: 'Repo' }],
    ['git@github.com:owner/repo.git',               { owner: 'owner', name: 'repo' }],
    ['git@github.com:owner/repo',                   { owner: 'owner', name: 'repo' }],
    ['  owner/repo  ',                              { owner: 'owner', name: 'repo' }],
    ['github.com/owner/repo',                       { owner: 'owner', name: 'repo' }],
    ['github.com/owner/repo/tree/main/path',        { owner: 'owner', name: 'repo' }],
    ['https://github.com/obra/superpowers',         { owner: 'obra', name: 'superpowers' }],
    ['owner-with-dashes/repo_with.dots',            { owner: 'owner-with-dashes', name: 'repo_with.dots' }],
  ])('parses %s', (input, expected) => {
    expect(parseGithubRepoUrl(input)).toEqual(expected)
  })
})

describe('parseGithubRepoUrl — rejects', () => {
  it.each<[string]>([
    [''],
    ['   '],
    ['owner'],
    ['owner/'],
    ['/repo'],
    ['owner/repo/extra/parts/many'],
    ['https://gitlab.com/owner/repo'],
    ['github.mycorp.com/o/r'],
    ['owner/repo with space'],
    ['owner/.repo'],
    ['.owner/repo'],
    ['../etc/passwd'],
    ['https://github.com/'],
    ['https://github.com/owner'],
    ['ssh://git@github.com/owner/repo'],
  ])('rejects %s', (input) => {
    expect(parseGithubRepoUrl(input)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests (expect module-not-found failure)**

```bash
npm test -- src/utils/parseGithubRepoUrl.test.ts
```

Expected: FAIL — `Failed to load url ./parseGithubRepoUrl`.

- [ ] **Step 3: Implement the parser**

Create `src/utils/parseGithubRepoUrl.ts`:

```ts
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/
const MAX_SEGMENT_LEN = 100

export function parseGithubRepoUrl(input: string): { owner: string; name: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // SSH: git@github.com:owner/repo[.git][/]
  const ssh = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)
  if (ssh) return validate(ssh[1], ssh[2])

  // HTTP(S): http(s)://github.com/owner/repo[.git][/anything]
  const http = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/.*)?$/i)
  if (http) return validate(http[1], http[2])

  // Bare host: github.com/owner/repo[/anything]
  const host = trimmed.match(/^github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/.*)?$/i)
  if (host) return validate(host[1], host[2])

  // Bare owner/repo — strictly 2 segments, no extras.
  const bare = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/)
  if (bare) return validate(bare[1], bare[2])

  return null
}

function validate(owner: string, name: string): { owner: string; name: string } | null {
  const cleanName = name.replace(/\.git$/i, '')
  if (!SEGMENT_RE.test(owner) || !SEGMENT_RE.test(cleanName)) return null
  if (owner.startsWith('.') || cleanName.startsWith('.')) return null
  if (owner.length > MAX_SEGMENT_LEN || cleanName.length > MAX_SEGMENT_LEN) return null
  return { owner, name: cleanName }
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- src/utils/parseGithubRepoUrl.test.ts
```

Expected: PASS (all accepted + rejected cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/parseGithubRepoUrl.ts src/utils/parseGithubRepoUrl.test.ts
git commit -m "feat(agents): URL parser for GitHub repo identifiers"
```

---

## Phase 2: GitHub fetcher service

### Task 2: `discoverSkillsInRepo` — skills-dir layout

**Files:**
- Create: `electron/services/skillImportFromGithubService.ts`
- Create: `electron/services/skillImportFromGithubService.test.ts`

- [ ] **Step 1: Write the test file**

Create `electron/services/skillImportFromGithubService.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../github')
vi.mock('../store')

import * as github from '../github'
import * as store from '../store'
import { discoverSkillsInRepo, RepoNotAccessibleError } from './skillImportFromGithubService'

const mockedGithub = vi.mocked(github)
const mockedStore = vi.mocked(store)

const SKILL_MD_BODY = `---
name: brainstorming
description: Brainstorm things.
---
# Brainstorming body`

beforeEach(() => {
  vi.resetAllMocks()
  mockedStore.getToken.mockReturnValue('test-token')
})

describe('discoverSkillsInRepo — skills-dir layout', () => {
  it('finds skills under skills/ and reports skills-dir layout', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'a1b2c3d4567', rootTreeSha: 'roottree' })
    mockedGithub.getTreeBySha
      // Root tree — has 'skills' subtree
      .mockResolvedValueOnce([
        { path: 'README.md', mode: '100644', type: 'blob', sha: 'rdmsha' },
        { path: 'skills',    mode: '040000', type: 'tree', sha: 'skillsroot' },
      ])
      // skills/ tree — two skill subdirs
      .mockResolvedValueOnce([
        { path: 'brainstorming', mode: '040000', type: 'tree', sha: 'brainsha' },
        { path: 'plan-writing',  mode: '040000', type: 'tree', sha: 'plansha' },
      ])
      // skills/brainstorming/ — has SKILL.md + one extra file
      .mockResolvedValueOnce([
        { path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sksha1' },
        { path: 'notes.md', mode: '100644', type: 'blob', sha: 'notesha' },
      ])
      // skills/plan-writing/ — has SKILL.md only
      .mockResolvedValueOnce([
        { path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sksha2' },
      ])
    mockedGithub.getRawFileBytes.mockImplementation(async (_t, _o, _n, _b, p) => {
      if (p === 'skills/brainstorming/SKILL.md') return Buffer.from(SKILL_MD_BODY, 'utf-8')
      if (p === 'skills/plan-writing/SKILL.md') {
        return Buffer.from(`---\nname: plan-writing\ndescription: Plan.\n---\n# Body`, 'utf-8')
      }
      throw new Error(`unexpected raw fetch: ${p}`)
    })

    const index = await discoverSkillsInRepo('obra', 'superpowers')

    expect(index.owner).toBe('obra')
    expect(index.name).toBe('superpowers')
    expect(index.branch).toBe('main')
    expect(index.commitSha).toBe('a1b2c3d4567')
    expect(index.layout).toBe('skills-dir')
    expect(index.skills).toHaveLength(2)
    expect(index.skills[0]).toMatchObject({
      name: 'brainstorming',
      description: 'Brainstorm things.',
      path: 'skills/brainstorming',
      fileCount: 2,
    })
    expect(index.skills[1]).toMatchObject({
      name: 'plan-writing',
      description: 'Plan.',
      path: 'skills/plan-writing',
      fileCount: 1,
    })
  })

  it('skips skill subdirs without SKILL.md', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([{ path: 'skills', mode: '040000', type: 'tree', sha: 'sk' }])
      .mockResolvedValueOnce([
        { path: 'valid',   mode: '040000', type: 'tree', sha: 'vsha' },
        { path: 'empty',   mode: '040000', type: 'tree', sha: 'esha' },
      ])
      // valid/ has SKILL.md
      .mockResolvedValueOnce([{ path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'vskill' }])
      // empty/ has only a README
      .mockResolvedValueOnce([{ path: 'README.md', mode: '100644', type: 'blob', sha: 'r' }])
    mockedGithub.getRawFileBytes.mockResolvedValue(Buffer.from(SKILL_MD_BODY, 'utf-8'))

    const index = await discoverSkillsInRepo('o', 'r')

    expect(index.skills).toHaveLength(1)
    expect(index.skills[0].path).toBe('skills/valid')
  })

  it('falls back to dir name when frontmatter name is missing', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([{ path: 'skills', mode: '040000', type: 'tree', sha: 'sk' }])
      .mockResolvedValueOnce([{ path: 'unnamed', mode: '040000', type: 'tree', sha: 'usha' }])
      .mockResolvedValueOnce([{ path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sksha' }])
    mockedGithub.getRawFileBytes.mockResolvedValue(Buffer.from(`---\ndescription: No name.\n---\nBody`, 'utf-8'))

    const index = await discoverSkillsInRepo('o', 'r')

    expect(index.skills[0].name).toBe('unnamed')
    expect(index.skills[0].description).toBe('No name.')
  })

  it('counts nested files (e.g., scripts/) in fileCount', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([{ path: 'skills', mode: '040000', type: 'tree', sha: 'sk' }])
      .mockResolvedValueOnce([{ path: 'foo', mode: '040000', type: 'tree', sha: 'foosha' }])
      // skills/foo/ — SKILL.md + scripts/ subdir
      .mockResolvedValueOnce([
        { path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sksha' },
        { path: 'scripts', mode: '040000', type: 'tree', sha: 'scrsha' },
      ])
      // skills/foo/scripts/ — two scripts
      .mockResolvedValueOnce([
        { path: 'a.sh', mode: '100755', type: 'blob', sha: 'asha' },
        { path: 'b.sh', mode: '100755', type: 'blob', sha: 'bsha' },
      ])
    mockedGithub.getRawFileBytes.mockResolvedValue(Buffer.from(SKILL_MD_BODY, 'utf-8'))

    const index = await discoverSkillsInRepo('o', 'r')

    expect(index.skills[0].fileCount).toBe(3)  // SKILL.md + scripts/a.sh + scripts/b.sh
  })
})
```

- [ ] **Step 2: Run the tests (expect module-not-found failure)**

```bash
npm test -- electron/services/skillImportFromGithubService.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service (skills-dir layout only)**

Create `electron/services/skillImportFromGithubService.ts`:

```ts
import matter from 'gray-matter'
import { getRepo, getBranch, getTreeBySha, getRawFileBytes } from '../github'
import { getToken } from '../store'
import type { DiscoveredSkill } from './skillImportService'

export class RepoNotAccessibleError extends Error {
  constructor(public readonly owner: string, public readonly name: string) {
    super(`Couldn't load ${owner}/${name}`)
    this.name = 'RepoNotAccessibleError'
  }
}

export interface RepoSkillIndex {
  owner: string
  name: string
  branch: string
  commitSha: string
  layout: 'skills-dir' | 'bare-root'
  skills: DiscoveredSkill[]
}

interface TreeEntry { path: string; mode: string; type: 'blob' | 'tree'; sha: string; size?: number }

const IGNORE_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '__pycache__'])
const IGNORE_SUFFIXES = ['.swp']

export async function discoverSkillsInRepo(
  owner: string,
  name: string,
): Promise<RepoSkillIndex> {
  const token = getToken() ?? null
  let repo: { default_branch: string }
  try {
    repo = await getRepo(token, owner, name)
  } catch {
    throw new RepoNotAccessibleError(owner, name)
  }
  const branch = repo.default_branch
  const { commitSha, rootTreeSha } = await getBranch(token, owner, name, branch)
  const rootEntries = await getTreeBySha(token, owner, name, rootTreeSha)

  const skillsEntry = rootEntries.find(e => e.path === 'skills' && e.type === 'tree')
  if (skillsEntry) {
    const skills = await listSkillsUnderSkillsDir(token, owner, name, branch, skillsEntry.sha)
    return { owner, name, branch, commitSha, layout: 'skills-dir', skills }
  }

  // No skills-dir found; bare-root not handled in this task — add in Task 3.
  return { owner, name, branch, commitSha, layout: 'skills-dir', skills: [] }
}

async function listSkillsUnderSkillsDir(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  skillsTreeSha: string,
): Promise<DiscoveredSkill[]> {
  const subdirs = await getTreeBySha(token, owner, name, skillsTreeSha)
  const out: DiscoveredSkill[] = []
  for (const sd of subdirs) {
    if (sd.type !== 'tree' || IGNORE_NAMES.has(sd.path)) continue
    const repoPath = `skills/${sd.path}`
    const skill = await summarizeSkillDir(token, owner, name, branch, sd.sha, repoPath, sd.path)
    if (skill) out.push(skill)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

async function summarizeSkillDir(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  treeSha: string,
  repoPath: string,
  dirName: string,
): Promise<DiscoveredSkill | null> {
  const entries = await getTreeBySha(token, owner, name, treeSha)
  const hasSkillMd = entries.some(e => e.path === 'SKILL.md' && e.type === 'blob')
  if (!hasSkillMd) return null

  const fileCount = await countFilesRecursive(token, owner, name, entries)

  let displayName = dirName
  let description: string | null = null
  try {
    const buf = await getRawFileBytes(token, owner, name, branch, `${repoPath}/SKILL.md`)
    const parsed = matter(buf.toString('utf-8'))
    const data = parsed.data as Record<string, unknown>
    if (typeof data.name === 'string' && data.name.length > 0) displayName = data.name
    if (typeof data.description === 'string') description = data.description
  } catch {
    // Frontmatter unreadable — fall back to defaults
  }

  return { name: displayName, path: repoPath, description, fileCount }
}

async function countFilesRecursive(
  token: string | null,
  owner: string,
  name: string,
  entries: TreeEntry[],
): Promise<number> {
  let count = 0
  for (const e of entries) {
    if (IGNORE_NAMES.has(e.path)) continue
    if (IGNORE_SUFFIXES.some(s => e.path.endsWith(s))) continue
    if (e.type === 'blob') count++
    else if (e.type === 'tree') {
      const sub = await getTreeBySha(token, owner, name, e.sha)
      count += await countFilesRecursive(token, owner, name, sub)
    }
  }
  return count
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- electron/services/skillImportFromGithubService.test.ts
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/skillImportFromGithubService.ts electron/services/skillImportFromGithubService.test.ts
git commit -m "feat(agents): discoverSkillsInRepo — walk skills/ in a GitHub repo"
```

### Task 3: `discoverSkillsInRepo` — bare-root layout

**Files:**
- Modify: `electron/services/skillImportFromGithubService.ts`
- Modify: `electron/services/skillImportFromGithubService.test.ts`

- [ ] **Step 1: Append tests**

```ts
describe('discoverSkillsInRepo — bare-root layout', () => {
  it('finds a root SKILL.md and reports bare-root layout', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha.mockResolvedValueOnce([
      { path: 'README.md', mode: '100644', type: 'blob', sha: 'r' },
      { path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sk' },
      { path: 'scripts', mode: '040000', type: 'tree', sha: 'scr' },
    ])
    // No second getTreeBySha needed because bare-root reads SKILL.md immediately,
    // and only walks for fileCount.
    // For fileCount we recurse — scripts/ subdir:
    mockedGithub.getTreeBySha.mockResolvedValueOnce([
      { path: 'run.sh', mode: '100755', type: 'blob', sha: 'rsh' },
    ])
    mockedGithub.getRawFileBytes.mockResolvedValue(Buffer.from(SKILL_MD_BODY, 'utf-8'))

    const index = await discoverSkillsInRepo('o', 'singleskill')

    expect(index.layout).toBe('bare-root')
    expect(index.skills).toHaveLength(1)
    expect(index.skills[0].path).toBe('.')
    expect(index.skills[0].name).toBe('brainstorming')   // from frontmatter
    expect(index.skills[0].fileCount).toBeGreaterThanOrEqual(2)  // SKILL.md + scripts/run.sh (README excluded)
  })

  it('returns empty skills[] when no skills/ and no root SKILL.md', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha.mockResolvedValueOnce([
      { path: 'README.md', mode: '100644', type: 'blob', sha: 'r' },
      { path: 'src',       mode: '040000', type: 'tree', sha: 's' },
    ])

    const index = await discoverSkillsInRepo('o', 'unrelated')

    expect(index.skills).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests (expect 2 FAIL)**

```bash
npm test -- electron/services/skillImportFromGithubService.test.ts -t "bare-root"
```

Expected: FAIL — bare-root layout returns empty skills[].

- [ ] **Step 3: Add bare-root handling**

In `electron/services/skillImportFromGithubService.ts`, replace the `// No skills-dir found...` comment and the trailing return in `discoverSkillsInRepo` with:

```ts
  const rootSkillMd = rootEntries.find(e => e.path === 'SKILL.md' && e.type === 'blob')
  if (rootSkillMd) {
    const skill = await summarizeBareRoot(token, owner, name, branch, rootEntries)
    return { owner, name, branch, commitSha, layout: 'bare-root', skills: skill ? [skill] : [] }
  }

  return { owner, name, branch, commitSha, layout: 'skills-dir', skills: [] }
```

Then add the `summarizeBareRoot` helper near `summarizeSkillDir`:

```ts
const BARE_ROOT_EXTRA_EXCLUDES = new Set([
  'README.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt',
  '.gitignore', '.gitattributes',
  'package.json', 'package-lock.json',
])

async function summarizeBareRoot(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  rootEntries: TreeEntry[],
): Promise<DiscoveredSkill | null> {
  const filtered = rootEntries.filter(e => !BARE_ROOT_EXTRA_EXCLUDES.has(e.path))
  const fileCount = await countFilesRecursive(token, owner, name, filtered)

  let displayName = name   // repo name as default
  let description: string | null = null
  try {
    const buf = await getRawFileBytes(token, owner, name, branch, 'SKILL.md')
    const parsed = matter(buf.toString('utf-8'))
    const data = parsed.data as Record<string, unknown>
    if (typeof data.name === 'string' && data.name.length > 0) displayName = data.name
    if (typeof data.description === 'string') description = data.description
  } catch {
    // SKILL.md frontmatter unreadable — fall back to repo name
  }

  return { name: displayName, path: '.', description, fileCount }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- electron/services/skillImportFromGithubService.test.ts
```

Expected: all PASS (skills-dir + bare-root).

- [ ] **Step 5: Commit**

```bash
git add electron/services/skillImportFromGithubService.ts electron/services/skillImportFromGithubService.test.ts
git commit -m "feat(agents): discoverSkillsInRepo — bare-root SKILL.md support"
```

### Task 4: `discoverSkillsInRepo` — error handling

**Files:**
- Modify: `electron/services/skillImportFromGithubService.test.ts`

- [ ] **Step 1: Append tests**

```ts
describe('discoverSkillsInRepo — errors', () => {
  it('throws RepoNotAccessibleError when getRepo rejects', async () => {
    mockedGithub.getRepo.mockRejectedValue(new Error('GitHub API error: 404'))

    await expect(discoverSkillsInRepo('o', 'doesnotexist')).rejects.toBeInstanceOf(RepoNotAccessibleError)
  })

  it('throws RepoNotAccessibleError carrying owner/name', async () => {
    mockedGithub.getRepo.mockRejectedValue(new Error('GitHub API error: 401'))

    try {
      await discoverSkillsInRepo('priv', 'repo')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(RepoNotAccessibleError)
      expect((err as RepoNotAccessibleError).owner).toBe('priv')
      expect((err as RepoNotAccessibleError).name).toBe('repo')
    }
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npm test -- electron/services/skillImportFromGithubService.test.ts -t "errors"
```

Expected: PASS — the existing implementation already wraps `getRepo` in try/catch.

- [ ] **Step 3: Commit (test-only)**

```bash
git add electron/services/skillImportFromGithubService.test.ts
git commit -m "test(agents): RepoNotAccessibleError coverage for discoverSkillsInRepo"
```

### Task 5: `readSkillFromRepo` — happy path

**Files:**
- Modify: `electron/services/skillImportFromGithubService.ts`
- Modify: `electron/services/skillImportFromGithubService.test.ts`

- [ ] **Step 1: Append tests**

```ts
import { readSkillFromRepo } from './skillImportFromGithubService'

describe('readSkillFromRepo — skills-dir', () => {
  it('returns ParsedSkill with body, description, files, and origin populated', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    // The trees we'll walk inside skills/brainstorming/
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([   // skills/brainstorming/ root
        { path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sksha' },
        { path: 'notes.md', mode: '100644', type: 'blob', sha: 'notesha' },
        { path: 'scripts',  mode: '040000', type: 'tree', sha: 'scrsha' },
      ])
      .mockResolvedValueOnce([   // skills/brainstorming/scripts/
        { path: 'run.sh', mode: '100755', type: 'blob', sha: 'rsh' },
      ])
    mockedGithub.getRawFileBytes.mockImplementation(async (_t, _o, _n, _b, p) => {
      if (p === 'skills/brainstorming/SKILL.md') return Buffer.from(SKILL_MD_BODY, 'utf-8')
      if (p === 'skills/brainstorming/notes.md') return Buffer.from('# Notes', 'utf-8')
      if (p === 'skills/brainstorming/scripts/run.sh') return Buffer.from('#!/bin/bash', 'utf-8')
      throw new Error(`unexpected fetch: ${p}`)
    })
    // For the tree walk, we need the tree SHA of skills/brainstorming.
    // readSkillFromRepo resolves it via a root → skills → skill walk:
    // we already mocked Tree calls above as a flat sequence; the implementation
    // uses getRawFileBytes for content and a separate tree walk for the file
    // index. Here we structure the mock so the first getTreeBySha gives the
    // skill's contents directly; see implementation.

    const skill = await readSkillFromRepo('obra', 'superpowers', 'main', 'a1b2c3d4567', 'skills/brainstorming')

    expect(skill.name).toBe('brainstorming')
    expect(skill.description).toBe('Brainstorm things.')
    expect(skill.body).toContain('# Brainstorming body')
    expect(skill.handle).toBe('brainstorming')
    expect(skill.files.map(f => f.filename).sort()).toEqual(['notes.md', 'scripts/run.sh'])
    expect(skill.files.find(f => f.filename === 'notes.md')?.content).toBe('# Notes')
    expect(skill.origin).toEqual({
      plugin: 'obra/superpowers',
      pluginVersion: 'a1b2c3d',
      path: 'skills/brainstorming',
    })
  })

  it('continues with remaining files when one file fetch fails', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getTreeBySha.mockResolvedValueOnce([
      { path: 'SKILL.md',  mode: '100644', type: 'blob', sha: 'sksha' },
      { path: 'good.md',   mode: '100644', type: 'blob', sha: 'goodsha' },
      { path: 'broken.md', mode: '100644', type: 'blob', sha: 'brokensha' },
    ])
    mockedGithub.getRawFileBytes.mockImplementation(async (_t, _o, _n, _b, p) => {
      if (p.endsWith('SKILL.md')) return Buffer.from(SKILL_MD_BODY, 'utf-8')
      if (p.endsWith('good.md')) return Buffer.from('good', 'utf-8')
      if (p.endsWith('broken.md')) throw new Error('fetch error')
      throw new Error(`unexpected: ${p}`)
    })

    const skill = await readSkillFromRepo('o', 'r', 'main', 'sha', 'skills/foo')

    expect(skill.files.map(f => f.filename)).toContain('good.md')
    expect(skill.files.map(f => f.filename)).not.toContain('broken.md')
  })

  it('skips ignored files', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getTreeBySha.mockResolvedValueOnce([
      { path: 'SKILL.md',   mode: '100644', type: 'blob', sha: 'sksha' },
      { path: '.DS_Store',  mode: '100644', type: 'blob', sha: 'dssha' },
      { path: 'real.md',    mode: '100644', type: 'blob', sha: 'rsha' },
    ])
    mockedGithub.getRawFileBytes.mockImplementation(async (_t, _o, _n, _b, p) => {
      if (p.endsWith('SKILL.md')) return Buffer.from(SKILL_MD_BODY, 'utf-8')
      if (p.endsWith('real.md')) return Buffer.from('r', 'utf-8')
      throw new Error(`unexpected: ${p}`)
    })

    const skill = await readSkillFromRepo('o', 'r', 'main', 'sha', 'skills/foo')

    expect(skill.files.map(f => f.filename)).toEqual(['real.md'])
  })
})

describe('readSkillFromRepo — bare-root', () => {
  it('excludes README.md, LICENSE, package.json from files[]', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getTreeBySha.mockResolvedValueOnce([
      { path: 'README.md',       mode: '100644', type: 'blob', sha: 'r' },
      { path: 'LICENSE',         mode: '100644', type: 'blob', sha: 'l' },
      { path: 'package.json',    mode: '100644', type: 'blob', sha: 'p' },
      { path: 'SKILL.md',        mode: '100644', type: 'blob', sha: 'sk' },
      { path: 'helper.md',       mode: '100644', type: 'blob', sha: 'h' },
    ])
    mockedGithub.getRawFileBytes.mockImplementation(async (_t, _o, _n, _b, p) => {
      if (p === 'SKILL.md') return Buffer.from(SKILL_MD_BODY, 'utf-8')
      if (p === 'helper.md') return Buffer.from('helper', 'utf-8')
      throw new Error(`unexpected: ${p}`)
    })

    const skill = await readSkillFromRepo('o', 'singleskill', 'main', 'sha', '.')

    expect(skill.files.map(f => f.filename)).toEqual(['helper.md'])
    expect(skill.origin?.path).toBe('.')
    expect(skill.origin?.plugin).toBe('o/singleskill')
  })
})
```

- [ ] **Step 2: Run tests (expect FAIL — readSkillFromRepo not exported)**

```bash
npm test -- electron/services/skillImportFromGithubService.test.ts -t "readSkillFromRepo"
```

Expected: FAIL.

- [ ] **Step 3: Implement `readSkillFromRepo`**

In `electron/services/skillImportFromGithubService.ts`, first extend the imports at the top of the file:

```ts
// Add to the existing import block:
import { slugifyName } from '../../src/utils/agentSlug'
import type { ParsedSkill } from './skillImportService'
```

(`DiscoveredSkill` is already imported from `./skillImportService` from Task 2; add `ParsedSkill` to the same import.)

Then append:

```ts
export async function readSkillFromRepo(
  owner: string,
  name: string,
  branch: string,
  commitSha: string,
  repoPath: string,
): Promise<ParsedSkill> {
  const token = getToken() ?? null
  const fileIndex = await listFilesUnderRepoPath(token, owner, name, branch, repoPath)
  const isBareRoot = repoPath === '.'
  const skillMdPath = isBareRoot ? 'SKILL.md' : `${repoPath}/SKILL.md`

  // Fetch and parse SKILL.md (the body)
  const skillBuf = await getRawFileBytes(token, owner, name, branch, skillMdPath)
  const parsed = matter(skillBuf.toString('utf-8'))
  const data = parsed.data as Record<string, unknown>
  const skillName = typeof data.name === 'string' && data.name.length > 0 ? data.name : (isBareRoot ? name : repoPath.split('/').pop()!)
  const description = typeof data.description === 'string' ? data.description : ''
  const known = new Set(['name', 'description'])
  const dropped = Object.keys(data).filter(k => !known.has(k))
  if (dropped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[skillImportFromGithubService] Dropped frontmatter keys from ${owner}/${name} ${repoPath}:`, dropped)
  }

  // Fetch sibling file contents, isolating per-file failures
  const files: { filename: string; content: string }[] = []
  for (const filename of fileIndex) {
    if (filename === (isBareRoot ? 'SKILL.md' : 'SKILL.md')) continue   // skip the body (already fetched)
    const fullPath = isBareRoot ? filename : `${repoPath}/${filename}`
    try {
      const buf = await getRawFileBytes(token, owner, name, branch, fullPath)
      files.push({ filename, content: buf.toString('utf-8') })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[skillImportFromGithubService] Failed to fetch ${fullPath}:`, err)
    }
  }
  files.sort((a, b) => a.filename.localeCompare(b.filename))

  return {
    name: skillName,
    handle: slugifyName(skillName),
    description,
    body: parsed.content.trim(),
    files,
    origin: {
      plugin: `${owner}/${name}`,
      pluginVersion: commitSha.slice(0, 7),
      path: repoPath,
    },
  }
}

/**
 * Returns relative paths (relative to repoPath, or to repo root for '.') of all
 * files under the given subtree, excluding ignored names and (for bare-root)
 * the extra-excluded files.
 */
async function listFilesUnderRepoPath(
  token: string | null,
  owner: string,
  name: string,
  branch: string,
  repoPath: string,
): Promise<string[]> {
  const isBareRoot = repoPath === '.'
  // Resolve the tree SHA for repoPath. For root we re-fetch via getBranch+getTreeBySha;
  // for nested paths we walk from the root tree down to the target dir.
  const { rootTreeSha } = await getBranch(token, owner, name, branch)
  let entries = await getTreeBySha(token, owner, name, rootTreeSha)
  if (!isBareRoot) {
    const segments = repoPath.split('/')
    for (const seg of segments) {
      const next = entries.find(e => e.path === seg && e.type === 'tree')
      if (!next) throw new Error(`Path not found in repo: ${repoPath}`)
      entries = await getTreeBySha(token, owner, name, next.sha)
    }
  }

  const out: string[] = []
  await collectFilesRecursive(token, owner, name, entries, '', isBareRoot, out)
  return out
}

async function collectFilesRecursive(
  token: string | null,
  owner: string,
  name: string,
  entries: TreeEntry[],
  prefix: string,
  isBareRoot: boolean,
  out: string[],
): Promise<void> {
  for (const e of entries) {
    if (IGNORE_NAMES.has(e.path)) continue
    if (IGNORE_SUFFIXES.some(s => e.path.endsWith(s))) continue
    if (isBareRoot && prefix === '' && BARE_ROOT_EXTRA_EXCLUDES.has(e.path)) continue
    const rel = prefix ? `${prefix}/${e.path}` : e.path
    if (e.type === 'blob') out.push(rel)
    else if (e.type === 'tree') {
      const sub = await getTreeBySha(token, owner, name, e.sha)
      await collectFilesRecursive(token, owner, name, sub, rel, isBareRoot, out)
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- electron/services/skillImportFromGithubService.test.ts
```

Expected: all PASS (discoverSkillsInRepo + readSkillFromRepo + error cases).

- [ ] **Step 5: Commit**

```bash
git add electron/services/skillImportFromGithubService.ts electron/services/skillImportFromGithubService.test.ts
git commit -m "feat(agents): readSkillFromRepo — fetch ParsedSkill from a GitHub repo"
```

---

## Phase 3: IPC routes

### Task 6: IPC handlers + preload + ambient types

**Files:**
- Modify: `electron/ipc/agentHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`

- [ ] **Step 1: Add the two IPC handlers**

In `electron/ipc/agentHandlers.ts`, extend the import line that already pulls from `skillImportService` to also pull from the new sibling service. Add a sibling import below the existing one (around line 6):

```ts
import { discoverSkillsInRepo, readSkillFromRepo, RepoNotAccessibleError } from '../services/skillImportFromGithubService'
import { parseGithubRepoUrl } from '../../src/utils/parseGithubRepoUrl'
```

Then add two new handlers inside `registerAgentHandlers()`, immediately after the existing `agents:import:importSkill` handler (which is the third import handler near the bottom of the function):

```ts
  ipcMain.handle('agents:import:discoverInRepo', async (_, url: string) => {
    const parsed = parseGithubRepoUrl(url)
    if (!parsed) throw new Error('Not a valid GitHub URL')
    return discoverSkillsInRepo(parsed.owner, parsed.name)
  })

  ipcMain.handle('agents:import:readSkillFromRepo', async (
    _, owner: string, name: string, branch: string, commitSha: string, repoPath: string,
  ) => {
    return readSkillFromRepo(owner, name, branch, commitSha, repoPath)
  })
```

(`RepoNotAccessibleError` is exported but does not need to be re-imported here — the error propagates over IPC as a plain `Error` with the same message, which is what the renderer needs.)

- [ ] **Step 2: Add the preload routes**

In `electron/preload.ts`, find the existing `import: { ... }` block (around line 240–250) and add two new methods inside it, after `importSkill`:

```ts
      discoverInRepo: (url: string) =>
        ipcRenderer.invoke('agents:import:discoverInRepo', url) as Promise<import('../electron/services/skillImportFromGithubService').RepoSkillIndex>,
      readSkillFromRepo: (
        owner: string, name: string, branch: string, commitSha: string, repoPath: string,
      ) =>
        ipcRenderer.invoke('agents:import:readSkillFromRepo', owner, name, branch, commitSha, repoPath) as Promise<import('../electron/services/skillImportService').ParsedSkill>,
```

- [ ] **Step 3: Add the ambient types**

In `src/env.d.ts`, find the existing `import: { ... }` block under `agents:` (around line 237) and append the two methods:

```ts
          discoverInRepo(url: string): Promise<import('../electron/services/skillImportFromGithubService').RepoSkillIndex>
          readSkillFromRepo(
            owner: string, name: string, branch: string, commitSha: string, repoPath: string,
          ): Promise<import('../electron/services/skillImportService').ParsedSkill>
```

- [ ] **Step 4: TS check**

```bash
npx tsc --noEmit 2>&1 | grep -v AgentsSidebar | head -20
```

Expected: no new errors. (The pre-existing AgentsSidebar narrowing error is unrelated.)

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/agentHandlers.ts electron/preload.ts src/env.d.ts
git commit -m "feat(agents): IPC routes for GitHub skill discovery + read"
```

---

## Phase 4: ImportSkillDialog UI

### Task 7: Extend the test mock + add render tests for the GitHub section

**Files:**
- Modify: `src/components/ImportSkillDialog.test.tsx`

- [ ] **Step 1: Extend the `beforeEach` mock**

In `src/components/ImportSkillDialog.test.tsx`, replace the `import: { ... }` block inside `beforeEach` with this (adds the two new methods alongside the existing three):

```ts
      import: {
        discoverPlugins: vi.fn().mockResolvedValue([
          { id: 'p1', name: 'superpowers', version: '5.1.0', root: '/p1', skills: [
            { name: 'brainstorming', path: '/p1/skills/brainstorming', description: 'Brainstorm things', fileCount: 4 },
            { name: 'writing-plans', path: '/p1/skills/writing-plans', description: 'Plan things', fileCount: 2 },
          ]},
          { id: 'p2', name: 'anatomy', version: null, root: '/p2', skills: [
            { name: 'foo', path: '/p2/skills/foo', description: null, fileCount: 1 },
          ]},
        ]),
        readSkillFromDisk: vi.fn().mockImplementation(async (p: string) => ({
          name: p.split('/').pop(), handle: p.split('/').pop(), description: '', body: '', files: [], origin: null,
        })),
        importSkill: vi.fn().mockResolvedValue({ agentId: 'new', conflictResolved: 'created' }),
        discoverInRepo: vi.fn().mockResolvedValue({
          owner: 'obra', name: 'superpowers', branch: 'main', commitSha: 'a1b2c3d4567',
          layout: 'skills-dir',
          skills: [
            { name: 'brainstorming', path: 'skills/brainstorming', description: 'Brainstorm', fileCount: 3 },
            { name: 'plan-writing',  path: 'skills/plan-writing',  description: 'Plan',       fileCount: 2 },
          ],
        }),
        readSkillFromRepo: vi.fn().mockImplementation(async (
          owner: string, name: string, _branch: string, sha: string, repoPath: string,
        ) => ({
          name: repoPath.split('/').pop(),
          handle: repoPath.split('/').pop(),
          description: '',
          body: '',
          files: [],
          origin: { plugin: `${owner}/${name}`, pluginVersion: sha.slice(0, 7), path: repoPath },
        })),
      },
```

- [ ] **Step 2: Append new tests for the GitHub section**

After the existing `describe('ImportSkillDialog', () => { ... })`, append a sibling block:

```ts
describe('ImportSkillDialog — GitHub section', () => {
  it('renders a URL input and a disabled Fetch button when URL is empty', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))   // wait for plugin scan to finish
    const input = screen.getByPlaceholderText(/owner\/repo/i)
    expect(input).toBeTruthy()
    const fetchBtn = screen.getByRole('button', { name: /^fetch$/i })
    expect((fetchBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables Fetch when the URL is valid', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    expect((screen.getByRole('button', { name: /^fetch$/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows an inline parse error for an invalid URL', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'not-a-valid-url' } })
    expect(screen.getByText(/not a valid github url/i)).toBeTruthy()
  })

  it('on Fetch, calls discoverInRepo and renders the skill list', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => expect(window.api.agents.import.discoverInRepo).toHaveBeenCalledWith('obra/superpowers'))
    await waitFor(() => screen.getByText('plan-writing'))
    expect(screen.getByText('brainstorming')).toBeTruthy()
  })

  it('shows "No skills found" when discoverInRepo returns empty skills', async () => {
    ;(window.api.agents.import.discoverInRepo as any) = vi.fn().mockResolvedValue({
      owner: 'o', name: 'r', branch: 'main', commitSha: 'sha', layout: 'skills-dir', skills: [],
    })
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'o/r' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText(/no skills found/i))
  })

  it('shows an error message when discoverInRepo rejects', async () => {
    ;(window.api.agents.import.discoverInRepo as any) = vi.fn().mockRejectedValue(new Error("Couldn't load priv/repo"))
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'priv/repo' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText(/couldn't load/i))
  })

  it('Import calls readSkillFromRepo + importSkill for each selected skill', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText('plan-writing'))
    fireEvent.click(screen.getByRole('button', { name: /import 2 skills/i }))
    await waitFor(() => expect(window.api.agents.import.readSkillFromRepo).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(window.api.agents.import.importSkill).toHaveBeenCalledTimes(2))
  })

  it('creates a folder named after the repo on import', async () => {
    render(<ImportSkillDialog open onClose={() => {}} />)
    await waitFor(() => screen.getByText('superpowers'))
    fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'obra/superpowers' } })
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }))
    await waitFor(() => screen.getByText('plan-writing'))
    fireEvent.click(screen.getByRole('button', { name: /import 2 skills/i }))
    await waitFor(() => expect(window.api.agents.createFolder).toHaveBeenCalledWith('superpowers'))
  })
})
```

- [ ] **Step 3: Run the tests (expect FAIL)**

```bash
npm test -- src/components/ImportSkillDialog.test.tsx -t "GitHub section"
```

Expected: 8 FAIL (URL input not rendered, etc.).

- [ ] **Step 4: Commit (tests only — they fail, but committing now lets the next task's diff focus on impl)**

Skip — combine into Task 8's commit so the failing tests aren't left in a separate commit on `main`.

### Task 8: Implement the GitHub section in `ImportSkillDialog.tsx`

**Files:**
- Modify: `src/components/ImportSkillDialog.tsx`

- [ ] **Step 1: Add imports + state at the top of the component**

In `src/components/ImportSkillDialog.tsx`, extend the top-level imports:

```ts
import { useEffect, useState, useMemo } from 'react'
import type { DiscoveredPlugin } from '../../electron/services/skillImportService'
import type { RepoSkillIndex } from '../../electron/services/skillImportFromGithubService'
import type { AgentFolderRow } from '../types/agent'
import { parseGithubRepoUrl } from '../utils/parseGithubRepoUrl'
```

Inside the `ImportSkillDialog` function, after the existing `useState` declarations, add:

```ts
  const [repoUrl, setRepoUrl] = useState('')
  const [repoIndex, setRepoIndex] = useState<RepoSkillIndex | null>(null)
  const [repoFetching, setRepoFetching] = useState(false)
  const [repoFetchError, setRepoFetchError] = useState<string | null>(null)
  const [repoSelected, setRepoSelected] = useState<Set<string>>(new Set())
  const [repoImporting, setRepoImporting] = useState(false)

  const repoUrlValid = useMemo(() => parseGithubRepoUrl(repoUrl) !== null, [repoUrl])
  const repoUrlError = repoUrl.length > 0 && !repoUrlValid ? 'Not a valid GitHub URL' : null
```

- [ ] **Step 2: Add the Fetch handler**

After the existing `handleImport` function definition, add:

```ts
  const handleFetchRepo = async () => {
    if (!repoUrlValid) return
    setRepoFetching(true)
    setRepoFetchError(null)
    try {
      const index = await window.api.agents.import.discoverInRepo(repoUrl)
      setRepoIndex(index)
      setRepoSelected(new Set(index.skills.map(s => s.path)))
    } catch (err) {
      setRepoFetchError((err as Error).message)
    } finally {
      setRepoFetching(false)
    }
  }

  const handleClearRepo = () => {
    setRepoIndex(null)
    setRepoSelected(new Set())
    setRepoFetchError(null)
  }

  const toggleRepoSkill = (path: string) => {
    setRepoSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleImportRepo = async () => {
    if (!repoIndex) return
    setRepoImporting(true)
    const failures: { name: string; error: string }[] = []
    try {
      const { folders } = await window.api.agents.getAll()
      let folder: AgentFolderRow | undefined = folders.find((f: AgentFolderRow) => f.name === repoIndex.name)
      if (!folder) folder = await window.api.agents.createFolder(repoIndex.name)
      const folderId = folder.id

      for (const skill of repoIndex.skills) {
        if (!repoSelected.has(skill.path)) continue
        try {
          const parsed = await window.api.agents.import.readSkillFromRepo(
            repoIndex.owner, repoIndex.name, repoIndex.branch, repoIndex.commitSha, skill.path,
          )
          await window.api.agents.import.importSkill(parsed, { folderId, onConflict: 'rename' })
        } catch (err) {
          failures.push({ name: skill.name, error: (err as Error).message })
        }
      }
      if (failures.length > 0) {
        const msg = `Imported with ${failures.length} failure${failures.length === 1 ? '' : 's'}:\n\n`
          + failures.map(f => `· ${f.name}: ${f.error}`).join('\n')
        window.alert(msg)
      }
      onClose()
    } finally {
      setRepoImporting(false)
    }
  }
```

- [ ] **Step 3: Render the new section**

In the JSX, find the closing `</section>` of the existing INSTALLED PLUGINS section (right before the closing `</div>` of `import-skill-modal`). Insert a new sibling `<section>` immediately after it:

```tsx
        <section className="import-skill-section">
          <div className="import-skill-section-label">From GitHub repository</div>

          {repoIndex === null && (
            <>
              <div className="import-skill-github-input-row">
                <input
                  type="text"
                  className="import-skill-github-input"
                  placeholder="owner/repo or https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && repoUrlValid && !repoFetching) handleFetchRepo() }}
                  disabled={repoFetching || repoImporting}
                />
                <button
                  type="button"
                  className="import-skill-github-fetch-btn"
                  onClick={handleFetchRepo}
                  disabled={!repoUrlValid || repoFetching || repoImporting}
                >
                  {repoFetching ? 'Fetching…' : 'Fetch'}
                </button>
              </div>
              {repoUrlError && <div className="import-skill-github-error">{repoUrlError}</div>}
              {repoFetchError && <div className="import-skill-github-error">{repoFetchError}</div>}
            </>
          )}

          {repoIndex !== null && (
            <div className="import-skill-github-skills">
              <div className="import-skill-github-chip">
                <span>
                  {repoIndex.owner}/{repoIndex.name}
                  {' '}({repoIndex.branch} @ {repoIndex.commitSha.slice(0, 7)})
                </span>
                <button
                  type="button"
                  className="import-skill-github-chip-clear"
                  onClick={handleClearRepo}
                  aria-label="Clear"
                  disabled={repoImporting}
                >✕</button>
              </div>

              {repoIndex.skills.length === 0 && (
                <div className="import-skill-empty">
                  No skills found in this repo. Looked for <code>skills/&lt;name&gt;/SKILL.md</code> and root <code>SKILL.md</code>.
                </div>
              )}

              {repoIndex.skills.map(s => (
                <label key={s.path} className="import-skill-skill-row">
                  <input
                    type="checkbox"
                    checked={repoSelected.has(s.path)}
                    onChange={() => toggleRepoSkill(s.path)}
                    disabled={repoImporting}
                  />
                  <span className="import-skill-skill-name">{s.name}</span>
                  {s.description && <span className="import-skill-skill-desc">{s.description}</span>}
                </label>
              ))}

              {repoIndex.skills.length > 0 && (
                <button
                  type="button"
                  className="import-skill-import-btn"
                  onClick={handleImportRepo}
                  disabled={repoImporting || repoSelected.size === 0}
                >
                  {repoImporting ? 'Importing…' : `Import ${repoSelected.size} ${repoSelected.size === 1 ? 'skill' : 'skills'}`}
                </button>
              )}
            </div>
          )}
        </section>
```

- [ ] **Step 4: Cross-section disabled coupling**

In the existing plugin-path Import button (inside the expanded plugin view), update the `disabled` prop to also disable when a repo import is in flight. Find:

```tsx
                    disabled={busy || selected.size === 0}
```

Change to:

```tsx
                    disabled={busy || repoImporting || selected.size === 0}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- src/components/ImportSkillDialog.test.tsx
```

Expected: all PASS (4 existing plugin-section tests + 8 new GitHub-section tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/ImportSkillDialog.tsx src/components/ImportSkillDialog.test.tsx
git commit -m "feat(agents): Import skill dialog — GitHub repo section"
```

### Task 9: CSS for the GitHub section

**Files:**
- Modify: `src/views/AgentDetail.css`

- [ ] **Step 1: Append the new rules**

In `src/views/AgentDetail.css`, find the end of the existing `.import-skill-import-btn:disabled` rule (the last `.import-skill-*` block, around line 1204). Append:

```css
.import-skill-github-input-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
  margin-top: 4px;
}
.import-skill-github-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--t1);
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  outline: none;
}
.import-skill-github-input:focus {
  border-color: var(--accent-border);
  background: rgba(255, 255, 255, 0.06);
}
.import-skill-github-fetch-btn {
  background: rgba(139, 92, 246, 0.18);
  color: var(--accent-text, #c4b5fd);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 6px;
  padding: 0 16px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.import-skill-github-fetch-btn:hover:not(:disabled) {
  background: rgba(139, 92, 246, 0.28);
}
.import-skill-github-fetch-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.import-skill-github-error {
  margin-top: 6px;
  color: #f87171;
  font-size: 11px;
}
.import-skill-github-skills {
  margin-top: 6px;
}
.import-skill-github-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(139, 92, 246, 0.12);
  color: var(--accent-text, #c4b5fd);
  border: 1px solid rgba(139, 92, 246, 0.25);
  border-radius: 999px;
  padding: 4px 10px 4px 12px;
  margin-bottom: 10px;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
}
.import-skill-github-chip-clear {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0 2px;
}
.import-skill-github-chip-clear:hover:not(:disabled) {
  color: #f87171;
}
.import-skill-github-chip-clear:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/AgentDetail.css
git commit -m "style(agents): CSS for GitHub repo import section"
```

---

## Phase 5: Verification

### Task 10: Run full test suite + TS check

- [ ] **Step 1: Full test run**

```bash
npm test
```

Expected: green. If anything outside the touched files broke, investigate before proceeding — likely a typing collision in the env.d.ts edits.

- [ ] **Step 2: TS check**

```bash
npx tsc --noEmit 2>&1 | grep -v AgentsSidebar
```

Expected: no new errors. (The pre-existing AgentsSidebar narrowing error is the same one the prior Phase 1 commit `735816c` fixed-then-flagged; it's unrelated.)

- [ ] **Step 3: If everything's green, hand off**

Print a summary of all commits in this branch since the previous HEAD (use `git log --oneline`) and let the user smoke-test the UI themselves (per their preference — they test UI changes themselves rather than having the agent launch dev servers).

---

## Self-review notes

**Spec coverage check** (run mentally against the spec sections):
- URL parser (spec §URL parser) → Task 1 ✓
- `discoverSkillsInRepo` (spec §Service / discover algorithm) → Tasks 2–4 ✓
- `readSkillFromRepo` (spec §Service / read algorithm) → Task 5 ✓
- `RepoNotAccessibleError` (spec §Error types) → covered in Tasks 2 + 4 ✓
- IPC routes + parsing in main (spec §IPC contract additions) → Task 6 ✓
- UI section + state machine (spec §UI changes) → Tasks 7–8 ✓
- CSS (spec §AgentDetail.css) → Task 9 ✓
- Error-handling matrix (spec §Error handling) → covered by Tasks 4 (service errors), 7+8 (UI display) ✓
- Test plan (spec §Test plan) → covered across Tasks 1, 2, 3, 4, 5, 7 ✓
- Disabled-state coupling (spec §Disabled states) → Task 8 Step 4 ✓

**Cross-task consistency:**
- `RepoSkillIndex` shape — defined in Task 2, consumed identically in Tasks 6 (preload), 7 (test mock), 8 (component state). ✓
- `readSkillFromRepo` signature `(owner, name, branch, commitSha, repoPath)` — same in service (Task 5), IPC handler (Task 6), preload (Task 6), env.d.ts (Task 6), test mock (Task 7), component (Task 8). ✓
- Origin shape `{ plugin, pluginVersion, path }` — populated by service (Task 5), preserved untouched through IPC (Task 6) and dialog (Task 8). ✓
- Folder naming — uses `repoIndex.name` (repo name only) in Task 8. Matches spec §Folder naming. ✓

**Skipped (intentional, documented in spec non-goals):**
- No conflict-resolution UI per skill — uses default `'rename'`.
- No "Pick from disk" entry path — separate concern.
- No subpath URL support — spec non-goal.
- No GHE host support — spec non-goal.
- No agents/<name>.md single-file layout — Phase 2.
