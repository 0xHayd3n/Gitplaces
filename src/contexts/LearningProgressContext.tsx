import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

export type LearningPhase = 'cloning' | 'validating' | 'generating' | 'verifying' | 'persisting'
export type LearningTerminalState = 'completed' | 'cancelled' | 'failed'

export interface LearningState {
  phase: LearningPhase | LearningTerminalState
  percent: number
  startedAt: number
  elapsedMs: number
  state: 'running' | LearningTerminalState
  error?: string
}

type LearningMap = Map<string, LearningState>

interface ContextValue {
  states: LearningMap
  startLearn: <T>(owner: string, name: string, fn: () => Promise<T>) => Promise<T>
  cancelLearn: (owner: string, name: string) => Promise<void>
}

const LearningProgressContext = createContext<ContextValue | null>(null)

const TERMINAL_DROP_DELAY_MS = 5000

const key = (owner: string, name: string) => `${owner}/${name}`

export function LearningProgressProvider({ children }: { children: React.ReactNode }) {
  const [states, setStates] = useState<LearningMap>(() => new Map())

  useEffect(() => {
    const cb = (event: {
      owner: string; name: string; phase: string; percent: number
      elapsedMs: number; state: 'running' | LearningTerminalState; error?: string
    }) => {
      const k = key(event.owner, event.name)
      setStates(prev => {
        const next = new Map(prev)
        const existing = next.get(k)
        const startedAt = existing?.startedAt ?? Date.now() - event.elapsedMs
        next.set(k, {
          phase: event.phase as LearningPhase | LearningTerminalState,
          percent: event.percent,
          startedAt,
          elapsedMs: event.elapsedMs,
          state: event.state,
          error: event.error,
        })
        return next
      })
      if (event.state !== 'running') {
        setTimeout(() => {
          setStates(prev => {
            const cur = prev.get(k)
            if (!cur || cur.state === 'running') return prev
            const next = new Map(prev)
            next.delete(k)
            return next
          })
        }, TERMINAL_DROP_DELAY_MS)
      }
    }
    window.api.skill.onLearnProgress(cb)
    return () => window.api.skill.offLearnProgress(cb)
  }, [])

  const startLearn = useCallback(<T,>(owner: string, name: string, fn: () => Promise<T>): Promise<T> => {
    const k = key(owner, name)
    setStates(prev => {
      const next = new Map(prev)
      next.set(k, {
        phase: 'cloning', percent: 0, startedAt: Date.now(), elapsedMs: 0, state: 'running',
      })
      return next
    })
    return fn()
  }, [])

  const cancelLearn = useCallback(async (owner: string, name: string) => {
    await window.api.skill.cancelLearn(owner, name)
  }, [])

  return (
    <LearningProgressContext.Provider value={{ states, startLearn, cancelLearn }}>
      {children}
    </LearningProgressContext.Provider>
  )
}

export function useLearningProgressContext(): ContextValue {
  const ctx = useContext(LearningProgressContext)
  if (!ctx) throw new Error('useLearningProgressContext must be used within LearningProgressProvider')
  return ctx
}

/** Test helper: a synthetic provider for component tests that don't want to mock IPC. */
export function MockLearningProgressProvider({
  initialStates = new Map(),
  children,
}: {
  initialStates?: LearningMap
  children: React.ReactNode
}) {
  const [states, setStates] = useState<LearningMap>(initialStates)
  const value: ContextValue = {
    states,
    startLearn: <T,>(owner: string, name: string, fn: () => Promise<T>) => {
      const k = key(owner, name)
      setStates(prev => {
        const next = new Map(prev)
        next.set(k, { phase: 'cloning', percent: 0, startedAt: Date.now(), elapsedMs: 0, state: 'running' })
        return next
      })
      return fn()
    },
    cancelLearn: async () => {},
  }
  return <LearningProgressContext.Provider value={value}>{children}</LearningProgressContext.Provider>
}
