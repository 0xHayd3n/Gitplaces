import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export function buildPushUrl(token: string, username: string, repoName: string): string {
  return `https://${token}@github.com/${username}/${repoName}.git`
}

export function cleanRepoUrl(username: string, repoName: string): string {
  return `https://github.com/${username}/${repoName}`
}

export async function gitInit(localPath: string): Promise<void> {
  await execAsync('git init', { cwd: localPath })
  await execAsync('git config user.email "gitplaces@local"', { cwd: localPath })
  await execAsync('git config user.name "Gitplaces"', { cwd: localPath })
}

export async function gitCommitAll(localPath: string, message: string): Promise<void> {
  await execAsync('git add .', { cwd: localPath })
  await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: localPath })
}

export async function gitPush(localPath: string, pushUrl: string): Promise<void> {
  try {
    await execAsync(`git remote add origin ${pushUrl}`, { cwd: localPath })
  } catch {
    await execAsync(`git remote set-url origin ${pushUrl}`, { cwd: localPath })
  }
  await execAsync('git push -u origin HEAD', { cwd: localPath })
}
