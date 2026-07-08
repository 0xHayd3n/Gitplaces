# PR review and merge cleanup — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review and merge the six open `devin/*` pull requests into `main`, then clean up stale local branches.

**Architecture:** Each PR is reviewed independently by fetching its branch, diffing against `main`, running typecheck/tests, and merging with a merge commit. Merges happen in PR number order to minimize conflicts. Stale local branches are deleted after all merges succeed.

**Tech Stack:** Git, GitHub CLI (`gh`), npm/PowerShell on Windows.

## Global Constraints
- Merge strategy: merge commits only (`gh pr merge --merge`).
- Delete PR branches and stale `claude/*` local branches after successful merges.
- Do not push unless explicitly asked.
- Typecheck command: `npx tsc --noEmit` (repo has no `npm run typecheck`).
- Tests: `npm test`. Baseline currently has 30 pre-existing failures (see Task 0). Each PR must not introduce *new* failures beyond this baseline; PRs that claim to fix tests must reduce or eliminate the relevant failures.

---

### Task 0: Establish baseline on main

**Files:**
- Working tree: `D:/Coding/Gitplaces`

- [ ] **Step 1: Ensure main is checked out and clean**

Run: `git checkout main`

Expected: `Switched to branch 'main'` and `git status --short` returns empty.

- [ ] **Step 2: Run baseline typecheck**

Run: `npx tsc --noEmit`

Expected: exits `0` with no errors.

- [ ] **Step 3: Run baseline tests**

Run: `npm test`

Expected: records the current baseline. As of this plan's creation, the baseline has 30 pre-existing failures:
- `vendor/anatomy/anatomy-cli/tests/mcp-memory-tools.test.ts`: 21 failed (`process.chdir()` not supported in workers)
- `vendor/anatomy/anatomy-cli/tests/pass2-config-loader.test.ts`: 3 failed (`process.chdir()` not supported in workers)
- `src/components/ImportPluginDialog.test.tsx`: 1 failed
- `src/components/ReadmeRenderer.test.tsx`: 5 failed

- [ ] **Step 4: Record baseline**

No commit needed; save the failure list for comparison in later tasks.

---

### Task 1: Review and merge PR #3 — command injection fix

**Files:**
- PR branch: `devin/1783536695-fix-git-command-injection`
- Likely touches: `electron/git.ts` or similar git service file

**Interfaces:**
- Consumes: current `createGitService` / `exec` usage
- Produces: hardened command execution using `execFile`

- [ ] **Step 1: Fetch PR branch locally**

Run: `gh pr checkout 3`

Expected: branch `devin/1783536695-fix-git-command-injection` is checked out.

- [ ] **Step 2: Diff against main**

Run: `git diff main...HEAD --stat`

Expected: lists changed files.

- [ ] **Step 3: Read the full diff**

Run: `git diff main...HEAD`

Expected: all git commands use `execFile` with argument arrays instead of shell strings.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`

Expected: exits `0`.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: exits `0`.

- [ ] **Step 6: Merge with merge commit**

Run: `gh pr merge 3 --merge --delete-branch`

Expected: PR #3 merged into `main`, branch deleted remotely.

- [ ] **Step 7: Return to main and verify**

Run: `git checkout main`

Expected: `main` now contains the merge commit.

---

### Task 2: Review and merge PR #4 — dedupe formatting helpers

**Files:**
- PR branch: `devin/1783536735-dedupe-format-utils`
- Likely touches: utility files and their consumers

**Interfaces:**
- Consumes: duplicated formatting helpers in caller files
- Produces: shared helpers in a utils module

- [ ] **Step 1: Fetch PR branch locally**

Run: `gh pr checkout 4`

Expected: branch `devin/1783536735-dedupe-format-utils` is checked out.

- [ ] **Step 2: Diff against main**

Run: `git diff main...HEAD --stat`

Expected: lists changed files.

- [ ] **Step 3: Read the full diff**

Run: `git diff main...HEAD`

Expected: helpers extracted to a shared location; callers updated to import from there.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`

Expected: exits `0`.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: exits `0`.

- [ ] **Step 6: Merge with merge commit**

Run: `gh pr merge 4 --merge --delete-branch`

Expected: PR #4 merged into `main`, branch deleted remotely.

- [ ] **Step 7: Return to main**

Run: `git checkout main`

Expected: on `main` with merge commit present.

---

### Task 3: Review and merge PR #5 — unit tests for low-coverage utilities

**Files:**
- PR branch: `devin/1783536867-add-unit-tests-low-coverage`
- Likely touches: `*.test.ts` files and possibly the modules under test

**Interfaces:**
- Consumes: existing utility functions without full test coverage
- Produces: expanded test coverage

- [ ] **Step 1: Fetch PR branch locally**

Run: `gh pr checkout 5`

Expected: branch `devin/1783536867-add-unit-tests-low-coverage` is checked out.

- [ ] **Step 2: Diff against main**

Run: `git diff main...HEAD --stat`

Expected: lists changed files.

- [ ] **Step 3: Read the full diff**

Run: `git diff main...HEAD`

Expected: tests are well-scoped and do not modify source behavior.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`

Expected: exits `0`.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: exits `0`.

- [ ] **Step 6: Merge with merge commit**

Run: `gh pr merge 5 --merge --delete-branch`

Expected: PR #5 merged into `main`, branch deleted remotely.

- [ ] **Step 7: Return to main**

Run: `git checkout main`

Expected: on `main` with merge commit present.

---

### Task 4: Review and merge PR #6 — error-handling improvements

**Files:**
- PR branch: `devin/1783536911-error-handling`
- Likely touches: error catching/logging sites across the codebase

**Interfaces:**
- Consumes: existing catch blocks that silently swallow errors
- Produces: surfaced errors (logging, user messaging, or re-throw)

- [ ] **Step 1: Fetch PR branch locally**

Run: `gh pr checkout 6`

Expected: branch `devin/1783536911-error-handling` is checked out.

- [ ] **Step 2: Diff against main**

Run: `git diff main...HEAD --stat`

Expected: lists changed files.

- [ ] **Step 3: Read the full diff**

Run: `git diff main...HEAD`

Expected: no new silently swallowed errors; surfaces are intentional and safe.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`

Expected: exits `0`.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: exits `0`.

- [ ] **Step 6: Merge with merge commit**

Run: `gh pr merge 6 --merge --delete-branch`

Expected: PR #6 merged into `main`, branch deleted remotely.

- [ ] **Step 7: Return to main**

Run: `git checkout main`

Expected: on `main` with merge commit present.

---

### Task 5: Review and merge PR #7 — auth polling hardening

**Files:**
- PR branch: `devin/1783536973-dev-flow-poll-hardening`
- Likely touches: GitHub device-flow auth code, AbortSignal listeners

**Interfaces:**
- Consumes: current device-flow polling loop and signal usage
- Produces: leak-free signal handling and hardened polling

- [ ] **Step 1: Fetch PR branch locally**

Run: `gh pr checkout 7`

Expected: branch `devin/1783536973-dev-flow-poll-hardening` is checked out.

- [ ] **Step 2: Diff against main**

Run: `git diff main...HEAD --stat`

Expected: lists changed files.

- [ ] **Step 3: Read the full diff**

Run: `git diff main...HEAD`

Expected: AbortSignal listeners are removed/cleaned; polling has timeouts/guards.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`

Expected: exits `0`.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: exits `0`.

- [ ] **Step 6: Merge with merge commit**

Run: `gh pr merge 7 --merge --delete-branch`

Expected: PR #7 merged into `main`, branch deleted remotely.

- [ ] **Step 7: Return to main**

Run: `git checkout main`

Expected: on `main` with merge commit present.

---

### Task 6: Review and merge PR #8 — window bounds migration

**Files:**
- PR branch: `devin/1783537148-window-bounds-migration`
- Likely touches: `electron/main.ts` or window-state store logic

**Interfaces:**
- Consumes: existing window bounds persistence
- Produces: one-time bounds migration and explicit `frame:true` on Windows

- [ ] **Step 1: Fetch PR branch locally**

Run: `gh pr checkout 8`

Expected: branch `devin/1783537148-window-bounds-migration` is checked out.

- [ ] **Step 2: Diff against main**

Run: `git diff main...HEAD --stat`

Expected: lists changed files.

- [ ] **Step 3: Read the full diff**

Run: `git diff main...HEAD`

Expected: migration runs once; Windows window frame is explicitly set.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`

Expected: exits `0`.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: exits `0`.

- [ ] **Step 6: Merge with merge commit**

Run: `gh pr merge 8 --merge --delete-branch`

Expected: PR #8 merged into `main`, branch deleted remotely.

- [ ] **Step 7: Return to main**

Run: `git checkout main`

Expected: on `main` with merge commit present.

---

### Task 7: Clean up stale local branches

**Files:**
- Local branches: `claude/angry-greider`, `claude/jolly-hodgkin-bb69c6`, `claude/stoic-hugle-13af2e`, `claude/zealous-buck-0497ed`

**Interfaces:**
- Consumes: branch list from `git branch`
- Produces: deleted local branches

- [ ] **Step 1: List current local branches**

Run: `git branch`

Expected: shows `main` and the four `claude/*` branches.

- [ ] **Step 2: Verify each branch is safe to delete**

Run:
```
git rev-list --count main..claude/angry-greider
git rev-list --count main..claude/jolly-hodgkin-bb69c6
git rev-list --count main..claude/stoic-hugle-13af2e
git rev-list --count main..claude/zealous-buck-0497ed
```

Expected: all counts are `0` (no commits on these branches that are not already on `main`).

- [ ] **Step 3: Delete stale branches**

Run:
```
git branch -D claude/angry-greider claude/jolly-hodgkin-bb69c6 claude/stoic-hugle-13af2e claude/zealous-buck-0497ed
```

Expected: each branch is deleted.

- [ ] **Step 4: Verify cleanup**

Run: `git branch`

Expected: only `main` remains locally.

---

### Task 8: Final verification on main

**Files:**
- Working tree: `D:/Coding/Gitplaces`

**Interfaces:**
- Consumes: merged code from PRs #3–#8
- Produces: verified clean `main`

- [ ] **Step 1: Confirm on main and clean tree**

Run: `git checkout main && git status --short`

Expected: `Switched to branch 'main'` and empty status.

- [ ] **Step 2: Final typecheck**

Run: `npx tsc --noEmit`

Expected: exits `0`.

- [ ] **Step 3: Final test run**

Run: `npm test`

Expected: exits `0`.

- [ ] **Step 4: Review merge commit log**

Run: `git log --oneline --merges -6`

Expected: six merge commits for PRs #3–#8 are present.

- [ ] **Step 5: Commit summary to user**

Report: which PRs merged, any blockers, and final test/typecheck status.

---

## Self-review

- **Spec coverage:** Every PR is a task; cleanup and final verification are tasks. Covered.
- **Placeholder scan:** No TBD/TODO. Commands and expected outputs are explicit.
- **Type consistency:** Not applicable — no new code types are introduced by this plan.
