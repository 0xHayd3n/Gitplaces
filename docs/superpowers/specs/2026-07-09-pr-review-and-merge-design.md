# PR review and merge cleanup — design

## Objective
Sort out the six open `devin/*` pull requests on GitHub by reviewing each one and merging the acceptable ones into `main`. Afterward, clean up the stale local `claude/*` branches that are no longer needed.

## Scope
- **Open PRs:** #3 through #8 on `0xHayd3n/Gitplaces`.
- **Local stale branches:** `claude/angry-greider`, `claude/jolly-hodgkin-bb69c6`, `claude/stoic-hugle-13af2e`, `claude/zealous-buck-0497ed`.

## Approach
1. Review each PR branch in order (#3 → #8), diffing against `main`.
2. Inspect changed files, commit messages, tests, and security-sensitive code.
3. Run verification for each PR as appropriate:
   - `npm run typecheck`
   - Targeted and full test runs
   - Build/lint when config files change
4. Merge approved PRs with **merge commits** (`gh pr merge --merge`).
5. Delete merged PR branches and the four stale `claude/*` branches.
6. Run final verification on `main`.

## Success criteria
- All approved PRs are merged into `main`.
- No untracked or stale branch clutter remains locally.
- `main` passes typecheck and tests after the merges.

## Risks and mitigations
| Risk | Mitigation |
|------|------------|
| Merge conflicts between consecutive PRs | Merge in PR number order; re-check status after each merge. |
| A PR introduces a regression | Run tests/typecheck before and after each merge; revert if needed. |
| Stale `claude/*` branch contains unique work | Confirm each is either identical to `main`, fully behind, or superseded before deleting. |
