// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { initSchema } from './db'
import {
  handleListSkills,
  handleGetSkill,
  handleSearchSkills,
  handleGetCollection,
  handleGetComponentsSkill,
} from './mcp-server'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  initSchema(db)
  return db
}

function seedRepo(db: Database.Database, owner: string, name: string): string {
  const repoId = `${owner}/${name}`
  db.prepare(
    `INSERT OR IGNORE INTO repos (id, owner, name, description, language, topics, stars, forks,
     license, homepage, updated_at, saved_at, type, banner_svg)
     VALUES (?, ?, ?, 'A test repo', 'TypeScript', '[]', 100, 10, NULL, NULL, NULL, NULL, NULL, NULL)`
  ).run(repoId, owner, name)
  return repoId
}

function seedSkill(db: Database.Database, repoId: string, filename: string, active = 1): void {
  db.prepare(
    `INSERT OR IGNORE INTO skills (repo_id, filename, content, version, generated_at, active)
     VALUES (?, ?, 'skill content', '1.0.0', '2026-01-01', ?)`
  ).run(repoId, filename, active)
}

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsuite-mcp-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ── handleListSkills ──────────────────────────────────────────────────────────

describe('handleListSkills', () => {
  it('returns message when no skills installed', () => {
    const db = makeDb()
    const result = handleListSkills(db)
    expect(result.content[0].text).toBe('No active skills installed.')
    db.close()
  })

  it('lists active skills with owner/name/language/version', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    seedSkill(db, repoId, 'fastapi.skill.md')
    const result = handleListSkills(db)
    const t = result.content[0].text
    expect(t).toContain('tiangolo/fastapi')
    expect(t).toContain('TypeScript')
    expect(t).toContain('1.0.0')
    db.close()
  })

  it('excludes inactive skills', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    seedSkill(db, repoId, 'fastapi.skill.md', 0)
    const result = handleListSkills(db)
    expect(result.content[0].text).toBe('No active skills installed.')
    db.close()
  })
})

// ── handleGetSkill ────────────────────────────────────────────────────────────

describe('handleGetSkill', () => {
  it('returns not-found message when file absent', () => {
    const result = handleGetSkill(tmpDir, 'tiangolo', 'fastapi')
    expect(result.content[0].text).toContain('No skill file found')
    expect(result.content[0].text).toContain('tiangolo/fastapi')
  })

  it('returns file content when skill file exists', () => {
    const skillDir = path.join(tmpDir, 'skills', 'tiangolo')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'fastapi.skill.md'), '## [CORE]\nHello', 'utf8')
    const result = handleGetSkill(tmpDir, 'tiangolo', 'fastapi')
    expect(result.content[0].text).toContain('## [CORE]')
    expect(result.content[0].text).toContain('Hello')
  })

  it('returns raw .anatomy + memory for anatomy-source rows', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'o', 'n')
    db.prepare(
      `INSERT INTO skills (repo_id, filename, content, version, generated_at, active, anatomy_source, anatomy_memory)
       VALUES (?, '.anatomy', ?, 'v', 't', 1, 'generated', ?)`
    ).run(repoId, '[identity]\nform="lib"', '[[entries]]\ntext="gotcha"')
    const res = handleGetSkill(tmpDir, 'o', 'n', db)
    expect(res.content[0].text).toMatch(/\[identity\]/)
    expect(res.content[0].text).toMatch(/Lived experience/)
    expect(res.content[0].text).toMatch(/gotcha/)
    db.close()
  })

  it('still reads the .skill.md file for legacy rows (no anatomy_source)', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'o2', 'n2')
    seedSkill(db, repoId, 'n2.skill.md')
    const skillDir = path.join(tmpDir, 'skills', 'o2')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'n2.skill.md'), '## [CORE]\nlegacy', 'utf8')
    expect(handleGetSkill(tmpDir, 'o2', 'n2', db).content[0].text).toMatch(/legacy/)
    db.close()
  })
})

// ── handleSearchSkills ────────────────────────────────────────────────────────

describe('handleSearchSkills', () => {
  it('searches raw .anatomy content for anatomy rows (no [CORE] needed)', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'o', 'n')
    db.prepare(
      `INSERT INTO skills (repo_id, filename, content, version, generated_at, active, anatomy_source)
       VALUES (?, '.anatomy', ?, 'v', 't', 1, 'generated')`
    ).run(repoId, '[identity]\nform="lib"\n\n[[rules]]\nstatement = "all DB writes go through db.ts"\n')
    const result = handleSearchSkills(db, tmpDir, 'db writes')
    expect(result.content[0].text).toContain('o/n')
    expect(result.content[0].text).toContain('Found in 1 skill(s)')
    db.close()
  })

  it('returns not-found message when query matches nothing', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    seedSkill(db, repoId, 'fastapi.skill.md')
    const skillDir = path.join(tmpDir, 'skills', 'tiangolo')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'fastapi.skill.md'), '## [CORE]\nFastAPI routing', 'utf8')
    const result = handleSearchSkills(db, tmpDir, 'sqlalchemy')
    expect(result.content[0].text).toContain('No skill files contain')
    db.close()
  })

  it('returns matching snippet when query found in CORE section', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    seedSkill(db, repoId, 'fastapi.skill.md')
    const skillDir = path.join(tmpDir, 'skills', 'tiangolo')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, 'fastapi.skill.md'),
      '## [CORE]\nFastAPI dependency injection\n## [EXTENDED]\nmore stuff',
      'utf8'
    )
    const result = handleSearchSkills(db, tmpDir, 'dependency injection')
    expect(result.content[0].text).toContain('tiangolo/fastapi')
    expect(result.content[0].text).toContain('Found in 1 skill(s)')
    db.close()
  })

  it('matches when all tokens appear in CORE section (AND semantics)', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    seedSkill(db, repoId, 'fastapi.skill.md')
    const skillDir = path.join(tmpDir, 'skills', 'tiangolo')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, 'fastapi.skill.md'),
      '## [CORE]\nFastAPI dependency injection and routing\n## [EXTENDED]\nmore stuff',
      'utf8'
    )
    const result = handleSearchSkills(db, tmpDir, 'dependency routing')
    expect(result.content[0].text).toContain('tiangolo/fastapi')
    expect(result.content[0].text).toContain('Found in 1 skill(s)')
    db.close()
  })

  it('does not match when only some tokens appear in CORE section', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    seedSkill(db, repoId, 'fastapi.skill.md')
    const skillDir = path.join(tmpDir, 'skills', 'tiangolo')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, 'fastapi.skill.md'),
      '## [CORE]\nFastAPI dependency injection\n## [EXTENDED]\nmore stuff',
      'utf8'
    )
    const result = handleSearchSkills(db, tmpDir, 'dependency routing')
    expect(result.content[0].text).toContain('No skill files contain')
    db.close()
  })

  it('does not match text only in EXTENDED section', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    seedSkill(db, repoId, 'fastapi.skill.md')
    const skillDir = path.join(tmpDir, 'skills', 'tiangolo')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, 'fastapi.skill.md'),
      '## [CORE]\nbasic routing\n## [EXTENDED]\nadvanced middleware',
      'utf8'
    )
    const result = handleSearchSkills(db, tmpDir, 'advanced middleware')
    expect(result.content[0].text).toContain('No skill files contain')
    db.close()
  })
})

// ── handleGetCollection ───────────────────────────────────────────────────────

describe('handleGetCollection', () => {
  it('uses anatomy_brief for depth=core and raw .anatomy for depth=full (anatomy rows)', () => {
    const db = makeDb()
    db.prepare(`INSERT INTO collections (id, name, owner, active, created_at) VALUES ('c1','Stack','user',1,'t')`).run()
    const repoId = seedRepo(db, 'o', 'n')
    db.prepare(
      `INSERT INTO skills (repo_id, filename, content, version, generated_at, active, anatomy_source, anatomy_brief)
       VALUES (?, '.anatomy', ?, 'v', 't', 1, 'generated', ?)`
    ).run(repoId, '[identity]\nform="full-raw"', 'BRIEF: form=lib')
    db.prepare(`INSERT INTO collection_repos (collection_id, repo_id) VALUES ('c1', ?)`).run(repoId)

    const core = handleGetCollection(db, tmpDir, 'Stack', 'core')
    expect(core.content[0].text).toContain('BRIEF: form=lib')
    expect(core.content[0].text).not.toContain('full-raw')

    const full = handleGetCollection(db, tmpDir, 'Stack', 'full')
    expect(full.content[0].text).toContain('full-raw')
    db.close()
  })

  it('returns not-found when collection does not exist', () => {
    const db = makeDb()
    const result = handleGetCollection(db, tmpDir, 'nonexistent')
    expect(result.content[0].text).toContain('No active collection named')
    db.close()
  })

  it('returns no-skills message when collection repos have no active skill', () => {
    const db = makeDb()
    db.prepare(
      `INSERT INTO collections (id, name, owner, active, created_at) VALUES ('c1', 'Python Stack', 'user', 1, '2026-01-01')`
    ).run()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    db.prepare(`INSERT INTO collection_repos (collection_id, repo_id) VALUES ('c1', ?)`).run(repoId)
    const result = handleGetCollection(db, tmpDir, 'Python Stack')
    expect(result.content[0].text).toContain('no active skills installed')
    db.close()
  })

  it('returns concatenated skill content for all active repos', () => {
    const db = makeDb()
    db.prepare(
      `INSERT INTO collections (id, name, owner, active, created_at) VALUES ('c1', 'Python Stack', 'user', 1, '2026-01-01')`
    ).run()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    seedSkill(db, repoId, 'fastapi.skill.md')
    db.prepare(`INSERT INTO collection_repos (collection_id, repo_id) VALUES ('c1', ?)`).run(repoId)
    const skillDir = path.join(tmpDir, 'skills', 'tiangolo')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'fastapi.skill.md'), '## [CORE]\nFastAPI', 'utf8')
    const result = handleGetCollection(db, tmpDir, 'Python Stack')
    expect(result.content[0].text).toContain('tiangolo/fastapi')
    expect(result.content[0].text).toContain('## [CORE]')
    db.close()
  })

  it('matches collection name case-insensitively and returns skill content', () => {
    const db = makeDb()
    db.prepare(
      `INSERT INTO collections (id, name, owner, active, created_at) VALUES ('c1', 'Python Stack', 'user', 1, '2026-01-01')`
    ).run()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    seedSkill(db, repoId, 'fastapi.skill.md')
    db.prepare(`INSERT INTO collection_repos (collection_id, repo_id) VALUES ('c1', ?)`).run(repoId)
    const skillDir = path.join(tmpDir, 'skills', 'tiangolo')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'fastapi.skill.md'), '## [CORE]\nFastAPI content', 'utf8')
    const result = handleGetCollection(db, tmpDir, 'python stack')
    expect(result.content[0].text).toContain('tiangolo/fastapi')
    expect(result.content[0].text).toContain('FastAPI content')
    db.close()
  })

  it('returns only CORE sections by default', () => {
    const db = makeDb()
    db.prepare(
      `INSERT INTO collections (id, name, owner, active, created_at) VALUES ('c1', 'Stack', 'user', 1, '2026-01-01')`
    ).run()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    seedSkill(db, repoId, 'fastapi.skill.md')
    db.prepare(`INSERT INTO collection_repos (collection_id, repo_id) VALUES ('c1', ?)`).run(repoId)
    const skillDir = path.join(tmpDir, 'skills', 'tiangolo')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, 'fastapi.skill.md'),
      '## [CORE]\nCore content here\n## [EXTENDED]\nExtended content here\n## [DEEP]\nDeep content here',
      'utf8'
    )
    const result = handleGetCollection(db, tmpDir, 'Stack')
    expect(result.content[0].text).toContain('Core content here')
    expect(result.content[0].text).not.toContain('Extended content here')
    expect(result.content[0].text).not.toContain('Deep content here')
    db.close()
  })

  it('returns full content when depth=full', () => {
    const db = makeDb()
    db.prepare(
      `INSERT INTO collections (id, name, owner, active, created_at) VALUES ('c1', 'Stack', 'user', 1, '2026-01-01')`
    ).run()
    const repoId = seedRepo(db, 'tiangolo', 'fastapi')
    seedSkill(db, repoId, 'fastapi.skill.md')
    db.prepare(`INSERT INTO collection_repos (collection_id, repo_id) VALUES ('c1', ?)`).run(repoId)
    const skillDir = path.join(tmpDir, 'skills', 'tiangolo')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, 'fastapi.skill.md'),
      '## [CORE]\nCore content\n## [EXTENDED]\nExtended content\n## [DEEP]\nDeep content',
      'utf8'
    )
    const result = handleGetCollection(db, tmpDir, 'Stack', 'full')
    expect(result.content[0].text).toContain('Core content')
    expect(result.content[0].text).toContain('Extended content')
    expect(result.content[0].text).toContain('Deep content')
    db.close()
  })
})

// ── handleGetComponentsSkill ─────────────────────────────────────────────────

describe('handleGetComponentsSkill', () => {
  it('returns not-found when no components sub-skill exists', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'shadcn-ui', 'ui')
    const result = handleGetComponentsSkill(db, tmpDir, 'shadcn-ui', 'ui')
    expect(result.content[0].text).toContain('No components skill file found')
    db.close()
  })

  it('returns file content when components sub-skill exists', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'shadcn-ui', 'ui')
    db.prepare(
      `INSERT INTO sub_skills (repo_id, skill_type, filename, content, version, generated_at, active)
       VALUES (?, 'components', 'ui.components.skill.md', 'comp content', '1.0.0', '2026-01-01', 1)`
    ).run(repoId)
    const skillDir = path.join(tmpDir, 'skills', 'shadcn-ui')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'ui.components.skill.md'), '## Components\nButton, Card', 'utf8')
    const result = handleGetComponentsSkill(db, tmpDir, 'shadcn-ui', 'ui')
    expect(result.content[0].text).toContain('Button, Card')
    db.close()
  })

  it('returns not-found when sub-skill is inactive', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'shadcn-ui', 'ui')
    db.prepare(
      `INSERT INTO sub_skills (repo_id, skill_type, filename, content, version, generated_at, active)
       VALUES (?, 'components', 'ui.components.skill.md', 'comp content', '1.0.0', '2026-01-01', 0)`
    ).run(repoId)
    const result = handleGetComponentsSkill(db, tmpDir, 'shadcn-ui', 'ui')
    expect(result.content[0].text).toContain('No components skill file found')
    db.close()
  })

  it('returns missing-on-disk when DB row exists but file is absent', () => {
    const db = makeDb()
    const repoId = seedRepo(db, 'shadcn-ui', 'ui')
    db.prepare(
      `INSERT INTO sub_skills (repo_id, skill_type, filename, content, version, generated_at, active)
       VALUES (?, 'components', 'ui.components.skill.md', 'comp content', '1.0.0', '2026-01-01', 1)`
    ).run(repoId)
    const result = handleGetComponentsSkill(db, tmpDir, 'shadcn-ui', 'ui')
    expect(result.content[0].text).toContain('missing on disk')
    db.close()
  })
})
