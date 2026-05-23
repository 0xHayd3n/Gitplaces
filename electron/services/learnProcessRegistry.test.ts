import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { learnProcessRegistry } from './learnProcessRegistry'

function fakeProc(): ChildProcess {
  return { kill: vi.fn(() => true), killed: false, exitCode: null } as unknown as ChildProcess
}

beforeEach(() => { learnProcessRegistry._reset() })

describe('learnProcessRegistry', () => {
  it('register marks key as present', () => {
    learnProcessRegistry.register('o/n', fakeProc())
    expect(learnProcessRegistry.has('o/n')).toBe(true)
  })

  it('unregister removes the entry', () => {
    learnProcessRegistry.register('o/n', fakeProc())
    learnProcessRegistry.unregister('o/n')
    expect(learnProcessRegistry.has('o/n')).toBe(false)
  })

  it('register replaces an existing entry (new phase, new subprocess)', () => {
    const first = fakeProc()
    const second = fakeProc()
    learnProcessRegistry.register('o/n', first)
    learnProcessRegistry.register('o/n', second)
    learnProcessRegistry.cancel('o/n')
    expect((second.kill as any)).toHaveBeenCalledWith('SIGTERM')
    expect((first.kill as any)).not.toHaveBeenCalled()
  })

  it('cancel sends SIGTERM and returns true', () => {
    const proc = fakeProc()
    learnProcessRegistry.register('o/n', proc)
    expect(learnProcessRegistry.cancel('o/n')).toBe(true)
    expect((proc.kill as any)).toHaveBeenCalledWith('SIGTERM')
  })

  it('cancel of unknown key returns false', () => {
    expect(learnProcessRegistry.cancel('missing/repo')).toBe(false)
  })

  it('escalates to SIGKILL after the grace window if process is still alive', () => {
    vi.useFakeTimers()
    const proc = fakeProc()
    learnProcessRegistry.register('o/n', proc)
    learnProcessRegistry.cancel('o/n')
    expect((proc.kill as any)).toHaveBeenCalledWith('SIGTERM')
    vi.advanceTimersByTime(2001)
    expect((proc.kill as any)).toHaveBeenCalledWith('SIGKILL')
    vi.useRealTimers()
  })

  it('does not escalate to SIGKILL if process already exited', () => {
    vi.useFakeTimers()
    const proc = fakeProc()
    learnProcessRegistry.register('o/n', proc)
    learnProcessRegistry.cancel('o/n')
    ;(proc as any).killed = true
    vi.advanceTimersByTime(2001)
    expect((proc.kill as any)).toHaveBeenCalledTimes(1) // only the SIGTERM
    vi.useRealTimers()
  })
})
