import { execFile } from 'child_process'
import { promisify } from 'util'

// Use execFile (no shell) with argument arrays so user-influenced values
// (commit messages, repo names, remote URLs) can never be interpreted by a
// shell. String-interpolated `exec` here was a command-injection vector.
const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}

export function buildPushUrl(token: string, username: string, repoName: string): string {
  return `https://${token}@github.com/${username}/${repoName}.git`
}

export function cleanRepoUrl(username: string, repoName: string): string {
  return `https://github.com/${username}/${repoName}`
}

export async function gitInit(localPath: string): Promise<void> {
  await git(localPath, ['init'])
  await git(localPath, ['config', 'user.email', 'gitplaces@local'])
  await git(localPath, ['config', 'user.name', 'Gitplaces'])
}

export async function gitCommitAll(localPath: string, message: string): Promise<void> {
  await git(localPath, ['add', '.'])
  await git(localPath, ['commit', '-m', message])
}

export async function gitPush(localPath: string, pushUrl: string): Promise<void> {
  try {
    await git(localPath, ['remote', 'add', 'origin', pushUrl])
  } catch {
    await git(localPath, ['remote', 'set-url', 'origin', pushUrl])
  }
  await git(localPath, ['push', '-u', 'origin', 'HEAD'])
}
