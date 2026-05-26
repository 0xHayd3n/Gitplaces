import type { DiffBaseRef } from './types'

export interface DiffBaseOption {
  label: string
  ref: DiffBaseRef
}

export function buildDiffBaseOptions(
  releases: { tag_name: string }[],
  currentBranch: string,
): DiffBaseOption[] {
  const opts: DiffBaseOption[] = []
  for (const r of releases.slice(0, 10)) {
    opts.push({ label: `vs ${r.tag_name}`, ref: { type: 'tag', ref: r.tag_name } })
  }
  if (currentBranch !== 'main') opts.push({ label: 'vs main', ref: { type: 'branch', ref: 'main' } })
  if (currentBranch !== 'master') opts.push({ label: 'vs master', ref: { type: 'branch', ref: 'master' } })
  opts.push({ label: 'vs HEAD~5', ref: { type: 'commit', ref: `${currentBranch}~5` } })
  opts.push({ label: 'vs HEAD~25', ref: { type: 'commit', ref: `${currentBranch}~25` } })
  return opts
}
