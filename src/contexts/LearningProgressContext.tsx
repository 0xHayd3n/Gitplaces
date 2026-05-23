import React, { createContext, useContext, useEffect, useRef, useCallback, useMemo } from 'react'

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
type Listener = () => void

interface LearningStore {
  states: LearningMap
  get: (key: string) => LearningState | null
  set: (key: string, value: LearningState) => void
  delete: (key: string) => void
  subscribe: (key: string, listener: Listener) => () => void
}

interface ContextValue {
  states: LearningMap
  startLearn: <T>(owner: string, name: string, fn: () => Promise<T>) => Promise<T>
  cancelLearn: (owner: string, name: string) => Promise<void>
  subscribe: LearningStore['subscribe']
  getSnapshot: LearningStore['get']
}

const LearningProgressContext = createContext<ContextValue | null>(null)

const TERMINAL_DROP_DELAY_MS = 5000

const key = (owner: string, name: string) => `${owner}/${name}`

// Per-key subscribable store. Mutated in place; subscribers are notified only
// when their specific key changes, so a row's render is independent of other
// rows' learning progress.
function createLearningStore(initial?: LearningMap): LearningStore {
  const statesMap: LearningMap = new Map(initial)
  const keyListeners = new Map<string, Set<Listener>>()
  const notify = (k: string) => keyListeners.get(k)?.forEach(l => l())

  return {
    states: statesMap,
    get: (k) => statesMap.get(k) ?? null,
    set: (k, value) => { statesMap.set(k, value); notify(k) },
    delete: (k) => { statesMap.delete(k); notify(k) },
    subscribe: (k, listener) => {
      let set = keyListeners.get(k)
      if (!set) { set = new Set(); keyListeners.set(k, set) }
      set.add(listener)
      return () => {
        const s = keyListeners.get(k)
        if (!s) return
        s.delete(listener)
        if (s.size === 0) keyListeners.delete(k)
      }
    },
  }
}

export function LearningProgressProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<LearningStore | null>(null)
  if (!storeRef.current) storeRef.current = createLearningStore()
  const store = storeRef.current

  useEffect(() => {
    const cb = (event: {
      owner: string; name: string; phase: string; percent: number
      elapsedMs: number; state: 'running' | LearningTerminalState; error?: string
    }) => {
      const k = key(event.owner, event.name)
      const existing = store.get(k)
      const startedAt = existing?.startedAt ?? Date.now() - event.elapsedMs
      store.set(k, {
        phase: event.phase as LearningPhase | LearningTerminalState,
        percent: event.percent,
        startedAt,
        elapsedMs: event.elapsedMs,
        state: event.state,
        error: event.error,
      })
      if (event.state !== 'running') {
        setTimeout(() => {
          const cur = store.get(k)
          if (!cur || cur.state === 'running') return
          store.delete(k)
        }, TERMINAL_DROP_DELAY_MS)
      }
    }
    window.api.skill.onLearnProgress(cb)
    return () => window.api.skill.offLearnProgress(cb)
  }, [store])

  const startLearn = useCallback(<T,>(owner: string, name: string, fn: () => Promise<T>): Promise<T> => {
    const k = key(owner, name)
    store.set(k, { phase: 'cloning', percent: 0, startedAt: Date.now(), elapsedMs: 0, state: 'running' })
    return fn()
  }, [store])

  const cancelLearn = useCallback(async (owner: string, name: string) => {
    await window.api.skill.cancelLearn(owner, name)
  }, [])

  const value = useMemo<ContextValue>(() => ({
    states: store.states,
    startLearn,
    cancelLearn,
    subscribe: store.subscribe,
    getSnapshot: store.get,
  }), [store, startLearn, cancelLearn])

  return (
    <LearningProgressContext.Provider value={value}>
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
  const storeRef = useRef<LearningStore | null>(null)
  if (!storeRef.current) storeRef.current = createLearningStore(initialStates)
  const store = storeRef.current

  const startLearn = useCallback(<T,>(owner: string, name: string, fn: () => Promise<T>): Promise<T> => {
    const k = key(owner, name)
    store.set(k, { phase: 'cloning', percent: 0, startedAt: Date.now(), elapsedMs: 0, state: 'running' })
    return fn()
  }, [store])

  const value = useMemo<ContextValue>(() => ({
    states: store.states,
    startLearn,
    cancelLearn: async () => {},
    subscribe: store.subscribe,
    getSnapshot: store.get,
  }), [store, startLearn])

  return <LearningProgressContext.Provider value={value}>{children}</LearningProgressContext.Provider>
}
