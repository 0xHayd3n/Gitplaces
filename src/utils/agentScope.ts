// Display + copy-payload prefix for agent handles. Currently hardcoded to the
// app's package name; promoted to a configurable setting in a follow-on spec.
export const AGENT_SCOPE = 'git-suite'

export function formatScopedHandle(handle: string): string {
  return `@${AGENT_SCOPE}/${handle}`
}
