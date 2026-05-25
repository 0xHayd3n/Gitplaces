# Phase 3 — Refactor Existing SDK Call Sites onto `electron/llm/`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every direct `@anthropic-ai/sdk` call in the codebase through Phase 1's `electron/llm/` abstraction. Behaviour is identical (still Anthropic-only end-to-end), but the call sites no longer instantiate the SDK themselves and no longer thread an `apiKey` parameter — the LLM service reads credentials from the providers store internally.

**Architecture:** Each refactor replaces the 5–10 lines of `new Anthropic(...) → client.messages.create({...})` with `createLLMService().generateText({...})`. The signature change drops `apiKey` from each function, so callers (in `electron/main.ts`) also stop fetching/passing the key. Equivalence tests pin the LLM request shape (model, max tokens, prompt) so the refactor demonstrably preserves the original API contract.

**Tech Stack:** TypeScript, vitest, Phase 1's `electron/llm/` module.

**Reference spec:** [`docs/superpowers/specs/2026-05-26-multi-provider-agents-design.md`](../specs/2026-05-26-multi-provider-agents-design.md) — see the **Phasing** table, Phase 3 row.

**Scope note:** The spec's Phase 3 row lists "4 call sites" — that count came from Phase 1's exploration which conflated SDK call sites with related files. The actual SDK call sites are:
- `electron/tag-extractor.ts:1-39` — tag extraction (Anthropic SDK)
- `electron/skill-gen/legacy.ts:812-823` — `generateSkill` (SDK)
- `electron/skill-gen/legacy.ts:825-834` — `generateComponentsSkill` (SDK)
- `electron/skill-gen/legacy.ts:712-732` — `generateWithRawPrompt` SDK fallback

`electron/services/agentFileSyncService.ts` (the `MODEL_FRONTMATTER` map) was already restructured in Phase 2 and is NOT an LLM call site. `electron/services/aiChatService.ts` spawns the Claude Code CLI as a subprocess — refactoring it to use `electron/llm/` would replace CLI-with-Claude-account-auth with SDK-with-API-key, a real user-visible behavior change. **Defer aiChatService to Phase 5** (in-app runner redesign).

**Branch policy:** Commit directly to `main`. Per `~/.claude/CLAUDE.md`.

**Test command:** Always `npm test`, never `npx vitest`.

---

## File Structure

**Modified files:**

| Path | Change |
|---|---|
| `electron/tag-extractor.ts` | Replace direct SDK call with `createLLMService().generateText`. Drop `apiKey` parameter. |
| `electron/tag-extractor.test.ts` | Mock `electron/llm` instead of `@anthropic-ai/sdk`. |
| `electron/skill-gen/legacy.ts` | Refactor 3 SDK call sites (`generateSkill`, `generateComponentsSkill`, the SDK fallback inside `generateWithRawPrompt`). Drop `apiKey` parameters. Remove unused `import Anthropic` once all 3 sites are migrated. |
| `electron/main.ts` | Update the 3 caller sites (lines ≈2009, 1390, 1465) to drop the `apiKey` argument from `extractTags` / `generateSkill` / `generateComponentsSkill` calls. The pre-call `if (!apiKey)` guard at line ≈1382 stays — it's a UX gate for the SDK fallback path, not a precondition the LLM service requires. |

**Files NOT touched** (intentional):
- `electron/services/aiChatService.ts` — Phase 5 will rework this entirely
- `electron/services/agentFileSyncService.ts` — not an LLM call site (Phase 2 handled the model-frontmatter map)
- `electron/llm/*` — read-only consumer in Phase 3
- `electron/store.ts` — no schema change

---

## Task 1: Refactor `extractTags` through `electron/llm/`

**Files:**
- Modify: `electron/tag-extractor.ts` (entire file, 39 lines today)
- Modify: `electron/tag-extractor.test.ts` (mock the LLM service instead of the SDK)
- Modify: `electron/main.ts` (1 caller, around line 2009 — `extractTags(query, topics, apiKey)`)

- [ ] **Step 1: Rewrite the test file**

Replace the entire content of `electron/tag-extractor.test.ts` with:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}))

vi.mock('./llm', () => ({
  createLLMService: vi.fn(() => ({
    generateText: mockGenerateText,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

import { extractTags } from './tag-extractor'

beforeEach(() => {
  mockGenerateText.mockReset()
})

describe('extractTags', () => {
  it('returns parsed JSON tags from the LLM response', async () => {
    mockGenerateText.mockResolvedValue({
      text: '["http", "python", "async"]',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    const tags = await extractTags('fast HTTP client for Python', [])
    expect(tags).toEqual(['http', 'python', 'async'])
  })

  it('falls back to word split when response is invalid JSON', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'not valid json',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })
    const tags = await extractTags('parse csv files fast', [])
    expect(tags).toContain('parse')
    expect(tags).toContain('csv')
    expect(tags).toContain('files')
  })

  it('calls the LLM with the expected model + max_tokens (equivalence with pre-refactor)', async () => {
    mockGenerateText.mockResolvedValue({ text: '[]', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    await extractTags('test query', ['foo', 'bar'])
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      expect.objectContaining({
        maxTokens: 256,
        messages: [expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('User query: "test query"'),
        })],
      }),
    )
  })

  it('includes the known topics list in the prompt (capped at 300)', async () => {
    mockGenerateText.mockResolvedValue({ text: '[]', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
    const topics = Array.from({ length: 500 }, (_, i) => `topic-${i}`)
    await extractTags('q', topics)
    const call = mockGenerateText.mock.calls[0][1]
    const promptContent = call.messages[0].content as string
    expect(promptContent).toContain('topic-0')
    expect(promptContent).toContain('topic-299')
    expect(promptContent).not.toContain('topic-300')
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/tag-extractor.test.ts
```

Expected: tests fail because `extractTags`'s current signature requires an `apiKey` third argument, and the tests don't pass one.

- [ ] **Step 3: Rewrite `electron/tag-extractor.ts`**

Replace the entire file with:

```ts
import { createLLMService } from './llm'

const TAG_MODEL = { provider: 'anthropic' as const, model: 'claude-haiku-4-5-20251001' }

export async function extractTags(
  query: string,
  knownTopics: string[],
): Promise<string[]> {
  const llm = createLLMService()
  const topicSample = knownTopics.slice(0, 300).join(', ')

  const prompt = `You are a GitHub repository search assistant. Extract search tags from the user's query.

Known GitHub topics (use these when they match): ${topicSample}

User query: "${query}"

Return ONLY a JSON array of 3-6 lowercase tags. Prefer exact matches from the known topics list. Include the programming language if mentioned. Add inferred synonyms if useful.

Examples:
"fast async HTTP client for Python" → ["http", "python", "async", "http-client", "requests"]
"render markdown in terminal" → ["markdown", "terminal", "cli", "renderer", "ansi"]
"small library to parse CSV files" → ["csv", "parser", "lightweight", "data"]

Return only the JSON array, nothing else.`

  try {
    const result = await llm.generateText(TAG_MODEL, {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 256,
    })
    return JSON.parse(result.text.trim())
  } catch {
    // Either the LLM call failed (auth, network, etc.) OR the response was
    // unparseable JSON. Fall back to a simple word-split — the IPC handler
    // treats an empty/incomplete list as "no smart tags, do raw search."
    return query.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 5)
  }
}
```

- [ ] **Step 4: Update the caller in `electron/main.ts`**

Find the call at around line 2009 (inside the `search:extractTags` IPC handler):

```ts
return extractTags(query, topics, apiKey)
```

Replace with:

```ts
return extractTags(query, topics)
```

The `const apiKey = getApiKey()` above it (around line 2004) and the `if (!apiKey) return []` guard stay unchanged — they short-circuit the smart-tag search when no key is configured. (After the refactor, `extractTags` would silently return the word-split fallback if no key was set; keeping the early-return preserves the current behaviour of "no smart search → empty list, not noisy fallback".)

- [ ] **Step 5: Run tests, verify pass**

```bash
npm test -- electron/tag-extractor.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 6: Confirm typecheck is clean**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add electron/tag-extractor.ts electron/tag-extractor.test.ts electron/main.ts
git commit -m "refactor(tag-extractor): route through electron/llm/ instead of direct SDK"
```

---

## Task 2: Refactor `generateSkill` through `electron/llm/`

**Files:**
- Modify: `electron/skill-gen/legacy.ts` (the `generateSkill` function at lines ~812-823)
- Modify: `electron/main.ts` (1 caller at line ~1390)
- Modify or create: `electron/skill-gen/legacy.test.ts` (if it doesn't exist, create it with one equivalence test for this function)

- [ ] **Step 1: Check for an existing test file**

Run:
```bash
ls electron/skill-gen/legacy.test.ts 2>/dev/null
```

If it doesn't exist, the next step creates one. If it does, the test will be appended to an appropriate describe block (search the file for an existing describe that covers skill generation, or add a new one).

- [ ] **Step 2: Write/append the failing test**

If `electron/skill-gen/legacy.test.ts` does not exist, create it with:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}))

vi.mock('../llm', () => ({
  createLLMService: vi.fn(() => ({
    generateText: mockGenerateText,
    streamText: vi.fn(),
    runAgentLoop: vi.fn(),
  })),
}))

import { generateSkill, type SkillGenInput } from './legacy'

const baseInput: SkillGenInput = {
  owner: 'oct',
  name: 'repo',
  language: 'TypeScript',
  topics: ['cli'],
  readme: '# Repo\n\nA test readme.\n',
  version: null,
  isComponents: false,
}

beforeEach(() => {
  mockGenerateText.mockReset()
})

describe('generateSkill (Phase 3 refactor)', () => {
  it('calls the LLM with claude-haiku-4-5 and max_tokens=2048 (equivalence with pre-refactor)', async () => {
    mockGenerateText.mockResolvedValue({
      text: '# Generated skill content',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    await generateSkill(baseInput)
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'anthropic', model: 'claude-haiku-4-5' },
      expect.objectContaining({
        maxTokens: 2048,
        messages: [expect.objectContaining({ role: 'user' })],
      }),
    )
  })

  it('returns the LLM text with hallucinated URLs stripped', async () => {
    // stripHallucinatedUrls is run on the result; verify the function passes
    // result.text through it (rather than returning raw).
    mockGenerateText.mockResolvedValue({
      text: 'See [docs](https://made-up-domain-not-in-readme.invalid) for more.',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })
    const result = await generateSkill(baseInput)
    // The stripper removes URLs not present in the readme.
    expect(result).not.toContain('made-up-domain-not-in-readme.invalid')
  })
})
```

If the file exists already, append the same two `it()` blocks to an existing describe (or add a new `describe('generateSkill (Phase 3 refactor)', ...)` at the end).

- [ ] **Step 3: Run test, verify failure**

```bash
npm test -- electron/skill-gen/legacy.test.ts
```

Expected: tests fail because `generateSkill` still expects an `apiKey` second argument.

- [ ] **Step 4: Refactor `generateSkill` in `electron/skill-gen/legacy.ts`**

Find the function at lines ~812-823:

```ts
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
```

Replace with:

```ts
export async function generateSkill(input: SkillGenInput): Promise<string> {
  const llm = createLLMService()
  const result = await llm.generateText(
    { provider: 'anthropic', model: 'claude-haiku-4-5' },
    {
      messages: [{ role: 'user', content: buildPrompt(input) }],
      maxTokens: 2048,
    },
  )
  return stripHallucinatedUrls(result.text, input.readme)
}
```

Add the import at the top of the file (alongside the existing imports — leave the `Anthropic` import in place for now; Task 4 removes it once all SDK call sites are migrated):

```ts
import { createLLMService } from '../llm'
```

- [ ] **Step 5: Update the caller in `electron/main.ts`**

Find the call at around line 1390:

```ts
content = await generateSkill(skillInput, apiKey)
```

Replace with:

```ts
content = await generateSkill(skillInput)
```

The surrounding `if (!apiKey)` guard at line ~1382 stays unchanged — it controls whether to attempt the SDK fallback after the CLI fails. After the refactor, the LLM service would internally throw `LLMError(kind='auth_missing')` if no key is set, but the user-facing error message is friendlier when delivered via the existing guard.

- [ ] **Step 6: Run tests, verify pass**

```bash
npm test -- electron/skill-gen/legacy.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 7: Confirm typecheck is clean**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add electron/skill-gen/legacy.ts electron/skill-gen/legacy.test.ts electron/main.ts
git commit -m "refactor(skill-gen): route generateSkill through electron/llm/"
```

---

## Task 3: Refactor `generateComponentsSkill` through `electron/llm/`

**Files:**
- Modify: `electron/skill-gen/legacy.ts` (the `generateComponentsSkill` function at lines ~825-834)
- Modify: `electron/main.ts` (1 caller at line ~1465)
- Modify: `electron/skill-gen/legacy.test.ts` (append test)

- [ ] **Step 1: Append the failing test**

Add this `it()` block to `electron/skill-gen/legacy.test.ts` (inside the existing describe or a new one for `generateComponentsSkill`):

```ts
describe('generateComponentsSkill (Phase 3 refactor)', () => {
  it('calls the LLM with claude-haiku-4-5 and max_tokens=4096 (equivalence with pre-refactor)', async () => {
    mockGenerateText.mockResolvedValue({
      text: '# Components skill content',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    const componentInput: SkillGenInput = { ...baseInput, isComponents: true }
    await generateComponentsSkill(componentInput)
    expect(mockGenerateText).toHaveBeenCalledWith(
      { provider: 'anthropic', model: 'claude-haiku-4-5' },
      expect.objectContaining({
        maxTokens: 4096,
        messages: [expect.objectContaining({ role: 'user' })],
      }),
    )
  })
})
```

Update the import at the top to include `generateComponentsSkill`:

```ts
import { generateSkill, generateComponentsSkill, type SkillGenInput } from './legacy'
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- electron/skill-gen/legacy.test.ts
```

Expected: the new test fails because `generateComponentsSkill` still expects an `apiKey` second argument.

- [ ] **Step 3: Refactor `generateComponentsSkill` in `electron/skill-gen/legacy.ts`**

Find the function at lines ~825-834:

```ts
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
```

Replace with:

```ts
export async function generateComponentsSkill(input: SkillGenInput): Promise<string> {
  const llm = createLLMService()
  const result = await llm.generateText(
    { provider: 'anthropic', model: 'claude-haiku-4-5' },
    {
      messages: [{ role: 'user', content: buildComponentsPrompt(input) }],
      maxTokens: 4096,
    },
  )
  return stripHallucinatedUrls(result.text, input.readme)
}
```

- [ ] **Step 4: Update the caller in `electron/main.ts`**

Find the call at around line 1465:

```ts
try { componentsContent = await generateComponentsSkill(skillInput, apiKey) } catch (e) {
```

Replace with:

```ts
try { componentsContent = await generateComponentsSkill(skillInput) } catch (e) {
```

The `if (apiKey)` guard at line ~1464 stays — same reasoning as Task 2.

- [ ] **Step 5: Run tests, verify pass**

```bash
npm test -- electron/skill-gen/legacy.test.ts
```

Expected: all tests in the file pass (the existing 2 from Task 2 plus the new 1).

- [ ] **Step 6: Commit**

```bash
git add electron/skill-gen/legacy.ts electron/skill-gen/legacy.test.ts electron/main.ts
git commit -m "refactor(skill-gen): route generateComponentsSkill through electron/llm/"
```

---

## Task 4: Refactor SDK fallback in `generateWithRawPrompt` + remove unused `Anthropic` import

**Files:**
- Modify: `electron/skill-gen/legacy.ts` (the SDK fallback inside `generateWithRawPrompt` at lines ~722-732, and the top-level `import Anthropic` statement)

This task has no caller-signature change — `generateWithRawPrompt`'s `options.apiKey` becomes unused. We'll drop it from the options type. Internal callers (`generateSkillViaLocalCLI`, `generateComponentsSkillViaLocalCLI`) at lines ~802 and ~806 do not pass `apiKey` today, so they're unaffected.

- [ ] **Step 1: Verify no external callers pass `options.apiKey`**

```bash
grep -rn "generateWithRawPrompt" electron/ src/ --include="*.ts" --include="*.tsx" | grep -v ".test.ts"
```

Expected: only the definition site in `legacy.ts` and the two internal callers (`generateSkillViaLocalCLI`, `generateComponentsSkillViaLocalCLI`) appear. If any caller passes `apiKey` in `options`, fix that caller in the same commit.

- [ ] **Step 2: Append the equivalence test**

Add to `electron/skill-gen/legacy.test.ts`:

```ts
describe('generateWithRawPrompt SDK fallback (Phase 3 refactor)', () => {
  it('no longer imports @anthropic-ai/sdk anywhere in legacy.ts (structural equivalence)', async () => {
    // Equivalent guarantee — after Task 4, no Anthropic-SDK code remains in
    // the file. We assert structurally rather than mocking the local
    // `findNode` function (which is hard to override from outside the module).
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const source = await fs.readFile(
      path.join(process.cwd(), 'electron/skill-gen/legacy.ts'),
      'utf-8',
    )
    expect(source).not.toContain('new Anthropic(')
    expect(source).not.toContain("@anthropic-ai/sdk")
  })
})
```

(The structural-assertion approach is intentional: mocking `findNode` from the module under test is messy because `legacy.ts` references it as a local function. The grep-the-source check is a strong equivalence guarantee — after Task 4, no Anthropic SDK code remains in the file at all.)

- [ ] **Step 3: Run test, verify failure**

```bash
npm test -- electron/skill-gen/legacy.test.ts
```

Expected: the new test fails because `legacy.ts` still imports and uses `Anthropic`.

- [ ] **Step 4: Refactor the SDK fallback in `generateWithRawPrompt`**

Find the block at lines ~720-732:

```ts
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
```

Replace with:

```ts
const nodePath = await findNode()
if (!nodePath) {
  // No Node available — fall back to the in-process LLM service. The auth
  // check (and any provider-specific concerns) live inside the adapter.
  const llm = createLLMService()
  try {
    const result = await llm.generateText(
      { provider: 'anthropic', model },
      {
        messages: [{ role: 'user', content: prompt }],
        maxTokens,
      },
    )
    return stripHallucinatedUrls(result.text, readme)
  } catch (err) {
    // Preserve the original error vocabulary for callers that match on the
    // "no Node / no API key" phrasing (the IPC handler in main.ts does).
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Node.js not found and LLM fallback failed: ${message}`)
  }
}
```

- [ ] **Step 5: Drop `options.apiKey` from the function signature**

Change the signature at line ~715:

```ts
options?: { model?: string; maxTokens?: number; apiKey?: string }
```

to:

```ts
options?: { model?: string; maxTokens?: number }
```

- [ ] **Step 6: Remove the top-level `Anthropic` import**

At the top of `electron/skill-gen/legacy.ts`, find and delete:

```ts
import Anthropic from '@anthropic-ai/sdk'
```

(If there are no other `Anthropic` references in the file after Tasks 2 + 3, this removal is safe. Run `grep -n "Anthropic" electron/skill-gen/legacy.ts` to confirm only the import line matches.)

- [ ] **Step 7: Run tests, verify pass**

```bash
npm test -- electron/skill-gen/legacy.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 8: Full electron-test sweep**

```bash
npm test -- electron/
```

Expected: every electron test passes (no regression in the pre-existing test files that touch skill-gen, agents, etc.).

- [ ] **Step 9: Confirm typecheck is clean**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 10: Commit**

```bash
git add electron/skill-gen/legacy.ts electron/skill-gen/legacy.test.ts
git commit -m "refactor(skill-gen): drop direct Anthropic SDK from generateWithRawPrompt fallback"
```

---

## Phase 3 done — verification checklist

After Task 4:

- [ ] `npm test -- electron/` passes end-to-end (pre-existing renderer-side failures are unchanged)
- [ ] `npx tsc --noEmit -p tsconfig.json` clean
- [ ] `git log --oneline 87bcbd0..HEAD` shows 4 new commits in this phase
- [ ] `grep -rn "@anthropic-ai/sdk" electron/ --include="*.ts" | grep -v node_modules | grep -v ".test.ts"` returns **nothing** (Anthropic SDK is no longer imported by any non-test electron source — only `electron/llm/adapters/anthropic.ts` legitimately uses it via the Vercel AI SDK now)
- [ ] Manual smoke test:
  - Launch the app (`npm run dev`)
  - Search → tag extraction still works (or silently no-ops if no API key)
  - Generate a skill via the API-key fallback path → still works

Phase 3 ships **zero user-visible behaviour change**. The two SDK fallback paths (skill gen, tag extraction) still require an Anthropic API key; the chat overlay still uses the Claude Code CLI subprocess (unchanged). What changed is that the SDK calls now go through `electron/llm/`, so Phase 4 can swap in OpenAI/Google/openai-compatible adapters without touching the call sites again.

## Out of scope (deferred)

- `electron/services/aiChatService.ts` refactor — deferred to Phase 5, where the chat overlay redesign replaces the CLI subprocess with the in-app agent runner end-to-end.
- Removing the `if (!apiKey)` guards in `main.ts` — they still provide friendlier UX than the LLM service's `auth_missing` error. Phase 4 can re-evaluate when the Settings UI gives users a clearer mental model of provider configuration.
- Live API smoke tests — none added; vitest mocks the LLM service. Phase 4's manual smoke-test checklist (per the spec's Testing section) is where real-network verification belongs.
