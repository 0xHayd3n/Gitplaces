// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, existsSync: vi.fn() }
})

import { detectOpenCode, checkOpenCodeAuthStatus, findOpenCodeBinary } from './opencode'

beforeEach(() => {
  mockSpawn.mockReset()
})

function makeSpawnMock(opts: { stdout?: string; stderr?: string; exitCode?: number }) {
  return {
    stdout: { on: (event: string, cb: (data: Buffer) => void) => { if (event === 'data' && opts.stdout) cb(Buffer.from(opts.stdout)) } },
    stderr: { on: (event: string, cb: (data: Buffer) => void) => { if (event === 'data' && opts.stderr) cb(Buffer.from(opts.stderr)) } },
    on: (event: string, cb: (code: number) => void) => { if (event === 'close') setImmediate(() => cb(opts.exitCode ?? 0)) },
  }
}

describe('findOpenCodeBinary', () => {
  it('returns null when opencode is not in PATH', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(findOpenCodeBinary()).toBeNull()
  })

  it('returns the path when opencode is found', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockImplementation((p: any) => String(p).includes('opencode'))
    expect(findOpenCodeBinary()).toMatch(/opencode/)
  })
})

describe('detectOpenCode', () => {
  it('returns true when the opencode binary is found', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    expect(await detectOpenCode()).toBe(true)
  })

  it('returns false when not found', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(await detectOpenCode()).toBe(false)
  })
})

describe('checkOpenCodeAuthStatus', () => {
  it('returns true when "opencode auth status" reports logged in', async () => {
    mockSpawn.mockReturnValue(makeSpawnMock({ stdout: '{"loggedIn":true}\n', exitCode: 0 }))
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    expect(await checkOpenCodeAuthStatus()).toBe(true)
  })

  it('returns false when the CLI reports loggedIn:false', async () => {
    mockSpawn.mockReturnValue(makeSpawnMock({ stdout: '{"loggedIn":false}\n', exitCode: 0 }))
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    expect(await checkOpenCodeAuthStatus()).toBe(false)
  })

  it('returns false when the CLI is not installed', async () => {
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(await checkOpenCodeAuthStatus()).toBe(false)
  })

  it('returns false when the CLI exits non-zero (not authenticated)', async () => {
    mockSpawn.mockReturnValue(makeSpawnMock({ stdout: '', exitCode: 1 }))
    const fs = await import('node:fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    expect(await checkOpenCodeAuthStatus()).toBe(false)
  })
})
