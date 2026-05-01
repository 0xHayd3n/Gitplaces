export type RepoUserEvent =
  | { type: 'star';    ts: string }
  | { type: 'archive'; ts: string }
  | { type: 'fork';    ts: string }
  | { type: 'learn';   ts: string; skillFilename: string; skillType: 'master' | 'components' }
