import type { ChildProcess } from 'node:child_process'

export type LearnKey = `${string}/${string}`

const SIGKILL_GRACE_MS = 2000

class LearnProcessRegistry {
  private procs = new Map<LearnKey, ChildProcess>()

  register(key: LearnKey, proc: ChildProcess): void {
    this.procs.set(key, proc)
  }

  unregister(key: LearnKey): void {
    this.procs.delete(key)
  }

  has(key: LearnKey): boolean {
    return this.procs.has(key)
  }

  /** SIGTERM the tracked process; escalate to SIGKILL after a 2s grace.
   *  Returns true if a process was found and signaled. */
  cancel(key: LearnKey): boolean {
    const proc = this.procs.get(key)
    if (!proc) return false
    proc.kill('SIGTERM')
    setTimeout(() => {
      if (!proc.killed && proc.exitCode === null) proc.kill('SIGKILL')
    }, SIGKILL_GRACE_MS)
    return true
  }

  /** Test-only: clear all entries. Module is a singleton so tests must reset. */
  _reset(): void {
    this.procs.clear()
  }
}

export const learnProcessRegistry = new LearnProcessRegistry()
