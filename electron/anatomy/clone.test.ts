import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, writeFile, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { cacheDirFor, exceedsCeiling, selectEvictions, ensureClone, type GitRunner } from './clone'

describe('cacheDirFor', () => {
  it('namespaces by owner/repo@sha and sanitises', () => {
    expect(cacheDirFor('/c', 'o', 'n', 'abc')).toBe(join('/c', 'o', 'n@abc'))
    expect(cacheDirFor('/c', 'o/x', 'n', 'a')).toBe(join('/c', 'o_x', 'n@a'))
  })
})

describe('exceedsCeiling', () => {
  it('compares GitHub size (KB) to a byte ceiling', () => {
    expect(exceedsCeiling(300_000, 250 * 1024 * 1024)).toBe(true)   // ~293 MB
    expect(exceedsCeiling(1000, 250 * 1024 * 1024)).toBe(false)
  })
})

describe('selectEvictions', () => {
  const now = 1_000_000_000_000
  it('evicts oldest first when over budget', () => {
    const entries = [
      { dir: 'a', bytes: 100, mtimeMs: now - 5000 },
      { dir: 'b', bytes: 100, mtimeMs: now - 1000 },
    ]
    expect(selectEvictions(entries, 150, 14 * 864e5, now)).toEqual(['a'])
  })
  it('evicts entries older than maxAge regardless of budget', () => {
    const entries = [{ dir: 'old', bytes: 1, mtimeMs: now - 20 * 864e5 }]
    expect(selectEvictions(entries, 1e9, 14 * 864e5, now)).toEqual(['old'])
  })
})

describe('ensureClone', () => {
  it('clones with --depth=1 --single-branch --branch and embeds token in URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clone-test-'))
    const calls: Array<{ args: string[]; cwd: string }> = []
    const fakeGit: GitRunner = async (args, cwd) => {
      calls.push({ args, cwd })
      if (args[0] === 'clone') {
        await mkdir(args[args.length - 1], { recursive: true })
        return ''
      }
      if (args[0] === 'rev-parse') return 'abc123def\n'
      throw new Error('unexpected: ' + args.join(' '))
    }

    const result = await ensureClone(root, 'foo', 'bar', 'main', 'TOKEN', fakeGit)

    expect(calls[0].args.slice(0, 5)).toEqual(['clone', '--depth=1', '--single-branch', '--branch', 'main'])
    expect(calls[0].args[5]).toBe('https://x-access-token:TOKEN@github.com/foo/bar.git')
    expect(calls[0].args[6]).toContain('bar@pending-')
    expect(calls[1].args).toEqual(['rev-parse', 'HEAD'])
    expect(result.sha).toBe('abc123def')
    expect(result.dir).toBe(join(root, 'foo', 'bar@abc123def'))
  })

  it('uses anonymous URL when token is null', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clone-test-'))
    let cloneUrl = ''
    const fakeGit: GitRunner = async (args, _cwd) => {
      if (args[0] === 'clone') {
        cloneUrl = args[5]
        await mkdir(args[args.length - 1], { recursive: true })
        return ''
      }
      return 'sha\n'
    }
    await ensureClone(root, 'foo', 'bar', 'main', null, fakeGit)
    expect(cloneUrl).toBe('https://github.com/foo/bar.git')
  })

  it('uses non-default branch (e.g. master) when passed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clone-test-'))
    let branchArg = ''
    const fakeGit: GitRunner = async (args, _cwd) => {
      if (args[0] === 'clone') {
        branchArg = args[4]
        await mkdir(args[args.length - 1], { recursive: true })
        return ''
      }
      return 'sha\n'
    }
    await ensureClone(root, 'mui', 'material-ui', 'master', null, fakeGit)
    expect(branchArg).toBe('master')
  })

  it('cleans up the pending dir when clone throws (e.g. EMFILE)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clone-test-'))
    let pendingDir = ''
    const fakeGit: GitRunner = async (args) => {
      if (args[0] === 'clone') {
        pendingDir = args[args.length - 1]
        await mkdir(pendingDir, { recursive: true })
        await writeFile(join(pendingDir, 'partial.txt'), 'x')
        throw new Error('EMFILE: too many open files')
      }
      return ''
    }

    await expect(ensureClone(root, 'foo', 'bar', 'main', null, fakeGit)).rejects.toThrow(/EMFILE/)
    expect(pendingDir).not.toBe('')
    await expect(stat(pendingDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cleans up the pending dir when rev-parse fails after clone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clone-test-'))
    let pendingDir = ''
    const fakeGit: GitRunner = async (args) => {
      if (args[0] === 'clone') {
        pendingDir = args[args.length - 1]
        await mkdir(pendingDir, { recursive: true })
        return ''
      }
      throw new Error('fatal: not a git repository')
    }

    await expect(ensureClone(root, 'foo', 'bar', 'main', null, fakeGit)).rejects.toThrow(/not a git/)
    expect(pendingDir).not.toBe('')
    await expect(stat(pendingDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('renames pending dir to @<sha> on success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clone-test-'))
    const fakeGit: GitRunner = async (args) => {
      if (args[0] === 'clone') {
        await mkdir(args[args.length - 1], { recursive: true })
        await writeFile(join(args[args.length - 1], 'README.md'), 'hello')
        return ''
      }
      return 'cafef00d\n'
    }
    const r = await ensureClone(root, 'foo', 'bar', 'main', null, fakeGit)
    expect(r.dir).toBe(join(root, 'foo', 'bar@cafef00d'))
    expect((await stat(r.dir)).isDirectory()).toBe(true)
    // contents preserved across rename
    const files = await readdir(r.dir)
    expect(files).toContain('README.md')
    // pending dir is gone
    const siblings = await readdir(join(root, 'foo'))
    expect(siblings.filter(s => s.includes('pending'))).toEqual([])
  })

  it('replaces existing finalDir if a prior clone of the same sha exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clone-test-'))
    const finalDir = join(root, 'foo', 'bar@deadbeef')
    await mkdir(finalDir, { recursive: true })
    await writeFile(join(finalDir, 'stale.txt'), 'old')

    const fakeGit: GitRunner = async (args) => {
      if (args[0] === 'clone') {
        await mkdir(args[args.length - 1], { recursive: true })
        await writeFile(join(args[args.length - 1], 'fresh.txt'), 'new')
        return ''
      }
      return 'deadbeef\n'
    }
    const r = await ensureClone(root, 'foo', 'bar', 'main', null, fakeGit)
    expect(r.dir).toBe(finalDir)
    const files = await readdir(finalDir)
    expect(files).toContain('fresh.txt')
    expect(files).not.toContain('stale.txt')
  })
})
