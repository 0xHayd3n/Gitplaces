import { useEffect, useState, useCallback } from 'react'
import { useLearningProgressContext, type LearningState } from '../contexts/LearningProgressContext'

interface UseLearningProgressResult {
  state: LearningState | null
  elapsedMs: number
  cancel: () => Promise<void>
}

const key = (owner: string, name: string) => `${owner}/${name}`

export function useLearningProgress(owner: string, name: string): UseLearningProgressResult {
  const { states, cancelLearn } = useLearningProgressContext()
  const state = states.get(key(owner, name)) ?? null

  const [, setTick] = useState(0)
  useEffect(() => {
    if (!state || state.state !== 'running') return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [state?.state])

  const elapsedMs = state ? Date.now() - state.startedAt : 0

  const cancel = useCallback(() => cancelLearn(owner, name), [cancelLearn, owner, name])

  return { state, elapsedMs, cancel }
}

/** Pure formatter: 47s / 2m 47s / 1h 2m 47s. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
