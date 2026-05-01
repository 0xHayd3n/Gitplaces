import type { GitHubFeedEvent } from '../hooks/useFeed'
import type { RepoUserEvent } from './repoUserEvents'

export type RepoActivityItem =
  | { kind: 'release'; ts: string; event: GitHubFeedEvent }
  | { kind: 'user';    ts: string; event: RepoUserEvent }
