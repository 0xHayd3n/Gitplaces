import { getRepoTree, getFileContent } from '../providers/github'
import { detectManifestFile } from './manifest-parser'

const MAX_FILES = 15

/**
 * Fetch the flat list of blob file paths from a repo tree.
 * Returns [] on any error (truncated tree, 403, network failure, etc.).
 */
export async function fetchFileTree(
  token: string | null,
  owner: string,
  name: string,
  branch: string
): Promise<string[]> {
  try {
    const entries = await getRepoTree(token, owner, name, branch)
    return entries.filter((e) => e.type === 'blob').map((e) => e.path)
  } catch {
    return []
  }
}

/**
 * Fetch file contents for up to 15 paths in parallel.
 * Skips files that return null or throw errors.
 */
export async function fetchRepoFiles(
  token: string | null,
  owner: string,
  name: string,
  paths: string[]
): Promise<Map<string, string>> {
  const limited = paths.slice(0, MAX_FILES)
  const results = await Promise.allSettled(
    limited.map((p) => getFileContent(token, owner, name, p).then((content) => ({ path: p, content })))
  )

  const map = new Map<string, string>()
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.content !== null) {
      map.set(result.value.path, result.value.content)
    }
  }
  return map
}

/**
 * Detect and fetch the manifest file (package.json, Cargo.toml, etc.) from the repo.
 * Returns null if no manifest is found in the tree, or if fetching fails.
 */
export async function fetchManifest(
  token: string | null,
  owner: string,
  name: string,
  fileTree: string[]
): Promise<{ filename: string; content: string } | null> {
  const filename = detectManifestFile(fileTree)
  if (!filename) return null

  try {
    const content = await getFileContent(token, owner, name, filename)
    if (content === null) return null
    return { filename, content }
  } catch {
    return null
  }
}
