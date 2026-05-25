// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../github')
vi.mock('../store')

import * as github from '../github'
import * as store from '../store'
import { discoverPluginInRepo, readTargetFromRepo, RepoNotAccessibleError } from './pluginImportFromGithubService'

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

describe('discoverPluginInRepo — skills-dir layout', () => {
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

    const index = await discoverPluginInRepo('obra', 'superpowers')

    expect(index.owner).toBe('obra')
    expect(index.name).toBe('superpowers')
    expect(index.branch).toBe('main')
    expect(index.commitSha).toBe('a1b2c3d4567')
    expect(index.layout).toBe('plugin')
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

    const index = await discoverPluginInRepo('o', 'r')

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

    const index = await discoverPluginInRepo('o', 'r')

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

    const index = await discoverPluginInRepo('o', 'r')

    expect(index.skills[0].fileCount).toBe(3)  // SKILL.md + scripts/a.sh + scripts/b.sh
  })
})

describe('discoverPluginInRepo — bare-root layout', () => {
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

    const index = await discoverPluginInRepo('o', 'singleskill')

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

    const index = await discoverPluginInRepo('o', 'unrelated')

    expect(index.skills).toEqual([])
  })
})

describe('discoverPluginInRepo — errors', () => {
  it('throws RepoNotAccessibleError when getRepo rejects', async () => {
    mockedGithub.getRepo.mockRejectedValue(new Error('GitHub API error: 404'))

    await expect(discoverPluginInRepo('o', 'doesnotexist')).rejects.toBeInstanceOf(RepoNotAccessibleError)
  })

  it('throws RepoNotAccessibleError carrying owner/name', async () => {
    mockedGithub.getRepo.mockRejectedValue(new Error('GitHub API error: 401'))

    try {
      await discoverPluginInRepo('priv', 'repo')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(RepoNotAccessibleError)
      expect((err as RepoNotAccessibleError).owner).toBe('priv')
      expect((err as RepoNotAccessibleError).repoName).toBe('repo')
    }
  })
})

describe('readTargetFromRepo — skills-dir', () => {
  it('returns ParsedSkill with body, description, files, and origin populated', async () => {
    // readTargetFromRepo walks (for kind=skill): getTreeBySha(commitSha) → root → skills → brainstorming
    // → scripts (because scripts/ is a subdir under brainstorming/).
    // No getBranch — we pass commitSha straight to getTreeBySha (GitHub resolves
    // commit SHAs as tree refs).
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([   // root tree (from commitSha)
        { path: 'skills', mode: '040000', type: 'tree', sha: 'skillssha' },
      ])
      .mockResolvedValueOnce([   // skills/ tree
        { path: 'brainstorming', mode: '040000', type: 'tree', sha: 'brainsha' },
      ])
      .mockResolvedValueOnce([   // skills/brainstorming/ tree
        { path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sksha' },
        { path: 'notes.md', mode: '100644', type: 'blob', sha: 'notesha' },
        { path: 'scripts',  mode: '040000', type: 'tree', sha: 'scrsha' },
      ])
      .mockResolvedValueOnce([   // skills/brainstorming/scripts/ tree
        { path: 'run.sh', mode: '100755', type: 'blob', sha: 'rsh' },
      ])
    mockedGithub.getRawFileBytes.mockImplementation(async (_t, _o, _n, _b, p) => {
      if (p === 'skills/brainstorming/SKILL.md') return Buffer.from(SKILL_MD_BODY, 'utf-8')
      if (p === 'skills/brainstorming/notes.md') return Buffer.from('# Notes', 'utf-8')
      if (p === 'skills/brainstorming/scripts/run.sh') return Buffer.from('#!/bin/bash', 'utf-8')
      throw new Error(`unexpected fetch: ${p}`)
    })

    const skill = await readTargetFromRepo('obra', 'superpowers', 'main', 'a1b2c3d4567', 'skills/brainstorming', 'skill')

    expect(skill.name).toBe('brainstorming')
    expect(skill.description).toBe('Brainstorm things.')
    expect(skill.body).toContain('# Brainstorming body')
    expect(skill.handle).toBe('brainstorming')
    expect(skill.files.map(f => f.filename).sort()).toEqual(['notes.md', 'scripts/run.sh'])
    expect(skill.files.find(f => f.filename === 'notes.md')?.content).toBe('# Notes')
    expect(skill.origin).toEqual({
      plugin: 'obra/superpowers',
      pluginVersion: 'a1b2c3d',
      path: 'skills/brainstorming',
    })
  })

  it('continues with remaining files when one file fetch fails', async () => {
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([   // root
        { path: 'skills', mode: '040000', type: 'tree', sha: 'skillssha' },
      ])
      .mockResolvedValueOnce([   // skills/
        { path: 'foo', mode: '040000', type: 'tree', sha: 'foosha' },
      ])
      .mockResolvedValueOnce([   // skills/foo/
        { path: 'SKILL.md',  mode: '100644', type: 'blob', sha: 'sksha' },
        { path: 'good.md',   mode: '100644', type: 'blob', sha: 'goodsha' },
        { path: 'broken.md', mode: '100644', type: 'blob', sha: 'brokensha' },
      ])
    mockedGithub.getRawFileBytes.mockImplementation(async (_t, _o, _n, _b, p) => {
      if (p.endsWith('SKILL.md')) return Buffer.from(SKILL_MD_BODY, 'utf-8')
      if (p.endsWith('good.md')) return Buffer.from('good', 'utf-8')
      if (p.endsWith('broken.md')) throw new Error('fetch error')
      throw new Error(`unexpected: ${p}`)
    })

    const skill = await readTargetFromRepo('o', 'r', 'main', 'sha1234', 'skills/foo', 'skill')

    expect(skill.files.map(f => f.filename)).toContain('good.md')
    expect(skill.files.map(f => f.filename)).not.toContain('broken.md')
  })

  it('skips ignored files', async () => {
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([   // root
        { path: 'skills', mode: '040000', type: 'tree', sha: 'skillssha' },
      ])
      .mockResolvedValueOnce([   // skills/
        { path: 'foo', mode: '040000', type: 'tree', sha: 'foosha' },
      ])
      .mockResolvedValueOnce([   // skills/foo/
        { path: 'SKILL.md',   mode: '100644', type: 'blob', sha: 'sksha' },
        { path: '.DS_Store',  mode: '100644', type: 'blob', sha: 'dssha' },
        { path: 'real.md',    mode: '100644', type: 'blob', sha: 'rsha' },
      ])
    mockedGithub.getRawFileBytes.mockImplementation(async (_t, _o, _n, _b, p) => {
      if (p.endsWith('SKILL.md')) return Buffer.from(SKILL_MD_BODY, 'utf-8')
      if (p.endsWith('real.md')) return Buffer.from('r', 'utf-8')
      throw new Error(`unexpected: ${p}`)
    })

    const skill = await readTargetFromRepo('o', 'r', 'main', 'sha1234', 'skills/foo', 'skill')

    expect(skill.files.map(f => f.filename)).toEqual(['real.md'])
  })
})

describe('readTargetFromRepo — bare-root', () => {
  it('excludes README.md, LICENSE, package.json from files[]', async () => {
    mockedGithub.getTreeBySha.mockResolvedValueOnce([
      { path: 'README.md',       mode: '100644', type: 'blob', sha: 'r' },
      { path: 'LICENSE',         mode: '100644', type: 'blob', sha: 'l' },
      { path: 'package.json',    mode: '100644', type: 'blob', sha: 'p' },
      { path: 'SKILL.md',        mode: '100644', type: 'blob', sha: 'sk' },
      { path: 'helper.md',       mode: '100644', type: 'blob', sha: 'h' },
    ])
    mockedGithub.getRawFileBytes.mockImplementation(async (_t, _o, _n, _b, p) => {
      if (p === 'SKILL.md') return Buffer.from(SKILL_MD_BODY, 'utf-8')
      if (p === 'helper.md') return Buffer.from('helper', 'utf-8')
      throw new Error(`unexpected: ${p}`)
    })

    const skill = await readTargetFromRepo('o', 'singleskill', 'main', 'sha1234', '.', 'skill')

    expect(skill.files.map(f => f.filename)).toEqual(['helper.md'])
    expect(skill.origin?.path).toBe('.')
    expect(skill.origin?.plugin).toBe('o/singleskill')
  })
})

describe('discoverPluginInRepo — mixed kinds', () => {
  it('returns skills, subagents, and slashCommands from a plugin-shaped repo', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'abc1234', rootTreeSha: 'rootsha' })
    mockedGithub.getTreeBySha
      // Root tree
      .mockResolvedValueOnce([
        { path: 'skills',   mode: '040000', type: 'tree', sha: 'skillssha' },
        { path: 'agents',   mode: '040000', type: 'tree', sha: 'agentssha' },
        { path: 'commands', mode: '040000', type: 'tree', sha: 'commandssha' },
      ])
      // skills/ tree
      .mockResolvedValueOnce([
        { path: 'a-skill', mode: '040000', type: 'tree', sha: 'askillsha' },
      ])
      // skills/a-skill/ tree
      .mockResolvedValueOnce([
        { path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'skillmdsha' },
      ])
      // agents/ tree
      .mockResolvedValueOnce([
        { path: 'agent-one.md', mode: '100644', type: 'blob', sha: 'agent1sha' },
      ])
      // commands/ tree
      .mockResolvedValueOnce([
        { path: 'cmd-one.md', mode: '100644', type: 'blob', sha: 'cmd1sha' },
      ])
    mockedGithub.getRawFileBytes.mockImplementation(async (_t, _o, _n, _b, p) => {
      if (p === 'skills/a-skill/SKILL.md') return Buffer.from(`---\nname: a-skill\ndescription: Sk.\n---\nbody`, 'utf-8')
      if (p === 'agents/agent-one.md')    return Buffer.from(`---\nname: agent-one\ndescription: Ag.\ncolor: red\n---\nbody`, 'utf-8')
      if (p === 'commands/cmd-one.md')    return Buffer.from(`---\ndescription: Cmd.\nargument-hint: [x]\n---\nbody`, 'utf-8')
      throw new Error(`unexpected raw fetch: ${p}`)
    })

    const index = await discoverPluginInRepo('owner', 'repo')

    expect(index.layout).toBe('plugin')
    expect(index.skills.map(s => s.name)).toEqual(['a-skill'])
    expect(index.subagents.map(s => s.name)).toEqual(['agent-one'])
    expect(index.subagents[0].color).toBe('red')
    expect(index.subagents[0].description).toBe('Ag.')
    expect(index.subagents[0].path).toBe('agents/agent-one.md')
    expect(index.slashCommands.map(c => c.name)).toEqual(['cmd-one'])
    expect(index.slashCommands[0].argumentHint).toBe('[x]')
    expect(index.slashCommands[0].description).toBe('Cmd.')
    expect(index.slashCommands[0].path).toBe('commands/cmd-one.md')
  })

  it('returns empty subagent/command arrays when only skills/ exists (regression)', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([{ path: 'skills', mode: '040000', type: 'tree', sha: 'sk' }])
      .mockResolvedValueOnce([{ path: 's1', mode: '040000', type: 'tree', sha: 's1sha' }])
      .mockResolvedValueOnce([{ path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sm' }])
    mockedGithub.getRawFileBytes.mockResolvedValue(Buffer.from(`---\nname: s1\ndescription: x\n---\n`, 'utf-8'))

    const index = await discoverPluginInRepo('o', 'r')

    expect(index.layout).toBe('plugin')
    expect(index.skills).toHaveLength(1)
    expect(index.subagents).toEqual([])
    expect(index.slashCommands).toEqual([])
  })

  it('preserves bare-root layout for repos with only a root SKILL.md', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([{ path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sm' }])
    mockedGithub.getRawFileBytes.mockResolvedValue(Buffer.from(`---\nname: bare\ndescription: x\n---\n`, 'utf-8'))

    const index = await discoverPluginInRepo('o', 'r')

    expect(index.layout).toBe('bare-root')
    expect(index.skills).toHaveLength(1)
    expect(index.subagents).toEqual([])
    expect(index.slashCommands).toEqual([])
  })
})

describe('readTargetFromRepo', () => {
  it('reads a sub-agent and returns ParsedSubagent with origin', async () => {
    mockedGithub.getRawFileBytes.mockResolvedValue(
      Buffer.from(`---\nname: agent-x\ndescription: An agent.\ncolor: blue\nmodel: sonnet\ntools: Read, Grep\n---\nagent body`, 'utf-8'),
    )

    const target = await readTargetFromRepo('owner', 'repo', 'main', 'abc1234567', 'agents/agent-x.md', 'subagent')

    expect(target.kind).toBe('subagent')
    expect(target.name).toBe('agent-x')
    expect(target.handle).toBe('agent-x')
    expect(target.description).toBe('An agent.')
    if (target.kind === 'subagent') expect(target.color).toBe('blue')
    expect(target.model).toBe('sonnet')
    expect(target.tools).toEqual(['Read', 'Grep'])
    expect(target.origin?.plugin).toBe('owner/repo')
    expect(target.origin?.path).toBe('agents/agent-x.md')
    expect(target.origin?.pluginVersion).toBe('abc1234')   // sliced to 7
  })

  it('reads a slash command and returns ParsedSlashCommand with origin', async () => {
    mockedGithub.getRawFileBytes.mockResolvedValue(
      Buffer.from(`---\ndescription: A cmd.\nargument-hint: [x]\n---\ncommand body`, 'utf-8'),
    )

    const target = await readTargetFromRepo('owner', 'repo', 'main', 'def4567890', 'commands/my-cmd.md', 'slashCommand')

    expect(target.kind).toBe('slashCommand')
    expect(target.name).toBe('my-cmd')
    expect(target.description).toBe('A cmd.')
    expect(target.argumentHint).toBe('[x]')
    expect(target.model).toBe('inherit')
    expect(target.tools).toBeNull()
    expect(target.origin?.path).toBe('commands/my-cmd.md')
  })

  it('reads a skill via the skill branch (delegates internally)', async () => {
    mockedGithub.getRepo.mockResolvedValue({ default_branch: 'main' } as any)
    mockedGithub.getBranch.mockResolvedValue({ commitSha: 'sha', rootTreeSha: 'root' })
    mockedGithub.getTreeBySha
      .mockResolvedValueOnce([{ path: 'skills', mode: '040000', type: 'tree', sha: 'sk' }])
      .mockResolvedValueOnce([{ path: 'my-skill', mode: '040000', type: 'tree', sha: 'mss' }])
      .mockResolvedValueOnce([{ path: 'SKILL.md', mode: '100644', type: 'blob', sha: 'sm' }])
    mockedGithub.getRawFileBytes.mockResolvedValue(
      Buffer.from(`---\nname: my-skill\ndescription: A skill.\n---\nbody`, 'utf-8'),
    )

    const target = await readTargetFromRepo('owner', 'repo', 'main', 'abc1234', 'skills/my-skill', 'skill')

    expect(target.kind).toBe('skill')
    expect(target.name).toBe('my-skill')
  })
})
