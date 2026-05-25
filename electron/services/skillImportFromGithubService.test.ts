// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../github')
vi.mock('../store')

import * as github from '../github'
import * as store from '../store'
import { discoverSkillsInRepo, RepoNotAccessibleError } from './skillImportFromGithubService'

const mockedGithub = vi.mocked(github)
const mockedStore = vi.mocked(store)

const SKILL_MD_BODY = `---
name: brainstorming
description: Brainstorm things.
---
# Brainstorming body`

beforeEach(() => {
  vi.resetAllMocks()
  mockedStore.getToken.mockReturnValue('test-token')
})

describe('discoverSkillsInRepo — skills-dir layout', () => {
  it('finds skills under skills/ and reports skills-dir layout', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'a1b2c3d4567', rootTreeSha: 'roottree' })
    mockedGithub.getTreeBySha
      // Root tree — has 'skills' subtree
      .mockResolvedValueOnce([
        { path: 'README.md', mode: '100644', type: 'blob', sha: 'rdmsha' },
        { path: 'skills',    mode: '040000', type: 'tree', sha: 'skillsroot' },
      ])
      // skills/ tree — two skill subdirs
      .mockResolvedValueOnce([
        { path: 'brainstorming', mode: '040000', type: 'tree', sha: 'brainsha' },
        { path: 'plan-writing',  mode: '040000', type: 'tree', sha: 'plansha' },
      ])
      // skills/brainstorming/ — has SKILL.md + one extra file
      .mockResolvedValueOnce([
        { path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sksha1' },
        { path: 'notes.md', mode: '100644', type: 'blob', sha: 'notesha' },
      ])
      // skills/plan-writing/ — has SKILL.md only
      .mockResolvedValueOnce([
        { path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sksha2' },
      ])
    mockedGithub.getRawFileBytes.mockImplementation(async (_t, _o, _n, _b, p) => {
      if (p === 'skills/brainstorming/SKILL.md') return Buffer.from(SKILL_MD_BODY, 'utf-8')
      if (p === 'skills/plan-writing/SKILL.md') {
        return Buffer.from(`---\nname: plan-writing\ndescription: Plan.\n---\n# Body`, 'utf-8')
      }
      throw new Error(`unexpected raw fetch: ${p}`)
    })

    const index = await discoverSkillsInRepo('obra', 'superpowers')

    expect(index.owner).toBe('obra')
    expect(index.name).toBe('superpowers')
    expect(index.branch).toBe('main')
    expect(index.commitSha).toBe('a1b2c3d4567')
    expect(index.layout).toBe('skills-dir')
    expect(index.skills).toHaveLength(2)
    expect(index.skills[0]).toMatchObject({
      name: 'brainstorming',
      description: 'Brainstorm things.',
      path: 'skills/brainstorming',
      fileCount: 2,
    })
    expect(index.skills[1]).toMatchObject({
      name: 'plan-writing',
      description: 'Plan.',
      path: 'skills/plan-writing',
      fileCount: 1,
    })
  })

  it('skips skill subdirs without SKILL.md', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([{ path: 'skills', mode: '040000', type: 'tree', sha: 'sk' }])
      .mockResolvedValueOnce([
        { path: 'valid',   mode: '040000', type: 'tree', sha: 'vsha' },
        { path: 'empty',   mode: '040000', type: 'tree', sha: 'esha' },
      ])
      // valid/ has SKILL.md
      .mockResolvedValueOnce([{ path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'vskill' }])
      // empty/ has only a README
      .mockResolvedValueOnce([{ path: 'README.md', mode: '100644', type: 'blob', sha: 'r' }])
    mockedGithub.getRawFileBytes.mockResolvedValue(Buffer.from(SKILL_MD_BODY, 'utf-8'))

    const index = await discoverSkillsInRepo('o', 'r')

    expect(index.skills).toHaveLength(1)
    expect(index.skills[0].path).toBe('skills/valid')
  })

  it('falls back to dir name when frontmatter name is missing', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([{ path: 'skills', mode: '040000', type: 'tree', sha: 'sk' }])
      .mockResolvedValueOnce([{ path: 'unnamed', mode: '040000', type: 'tree', sha: 'usha' }])
      .mockResolvedValueOnce([{ path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sksha' }])
    mockedGithub.getRawFileBytes.mockResolvedValue(Buffer.from(`---\ndescription: No name.\n---\nBody`, 'utf-8'))

    const index = await discoverSkillsInRepo('o', 'r')

    expect(index.skills[0].name).toBe('unnamed')
    expect(index.skills[0].description).toBe('No name.')
  })

  it('counts nested files (e.g., scripts/) in fileCount', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([{ path: 'skills', mode: '040000', type: 'tree', sha: 'sk' }])
      .mockResolvedValueOnce([{ path: 'foo', mode: '040000', type: 'tree', sha: 'foosha' }])
      // skills/foo/ — SKILL.md + scripts/ subdir
      .mockResolvedValueOnce([
        { path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sksha' },
        { path: 'scripts', mode: '040000', type: 'tree', sha: 'scrsha' },
      ])
      // skills/foo/scripts/ — two scripts
      .mockResolvedValueOnce([
        { path: 'a.sh', mode: '100755', type: 'blob', sha: 'asha' },
        { path: 'b.sh', mode: '100755', type: 'blob', sha: 'bsha' },
      ])
    mockedGithub.getRawFileBytes.mockResolvedValue(Buffer.from(SKILL_MD_BODY, 'utf-8'))

    const index = await discoverSkillsInRepo('o', 'r')

    expect(index.skills[0].fileCount).toBe(3)  // SKILL.md + scripts/a.sh + scripts/b.sh
  })
})

describe('discoverSkillsInRepo — bare-root layout', () => {
  it('finds a root SKILL.md and reports bare-root layout', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([
        { path: 'README.md', mode: '100644', type: 'blob', sha: 'r' },
        { path: 'SKILL.md',  mode: '100644', type: 'blob', sha: 'sk' },
        { path: 'scripts',   mode: '040000', type: 'tree', sha: 'scr' },
      ])
      // For fileCount we recurse into scripts/
      .mockResolvedValueOnce([
        { path: 'run.sh', mode: '100755', type: 'blob', sha: 'rsh' },
      ])
    mockedGithub.getRawFileBytes.mockResolvedValue(Buffer.from(SKILL_MD_BODY, 'utf-8'))

    const index = await discoverSkillsInRepo('o', 'singleskill')

    expect(index.layout).toBe('bare-root')
    expect(index.skills).toHaveLength(1)
    expect(index.skills[0].path).toBe('.')
    expect(index.skills[0].name).toBe('brainstorming')   // from SKILL.md frontmatter
    // README.md excluded, SKILL.md + scripts/run.sh counted = 2
    expect(index.skills[0].fileCount).toBe(2)
  })

  it('returns empty skills[] when no skills/ and no root SKILL.md', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha.mockResolvedValueOnce([
      { path: 'README.md', mode: '100644', type: 'blob', sha: 'r' },
      { path: 'src',       mode: '040000', type: 'tree', sha: 's' },
    ])

    const index = await discoverSkillsInRepo('o', 'unrelated')

    expect(index.skills).toEqual([])
  })
})

describe('discoverSkillsInRepo — errors', () => {
  it('throws RepoNotAccessibleError when getRepo rejects', async () => {
    mockedGithub.getRepo.mockRejectedValue(new Error('GitHub API error: 404'))

    await expect(discoverSkillsInRepo('o', 'doesnotexist')).rejects.toBeInstanceOf(RepoNotAccessibleError)
  })

  it('throws RepoNotAccessibleError carrying owner/name', async () => {
    mockedGithub.getRepo.mockRejectedValue(new Error('GitHub API error: 401'))

    try {
      await discoverSkillsInRepo('priv', 'repo')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(RepoNotAccessibleError)
      expect((err as RepoNotAccessibleError).owner).toBe('priv')
      expect((err as RepoNotAccessibleError).repoName).toBe('repo')
    }
  })
})
