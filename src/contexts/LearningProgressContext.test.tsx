import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { LearningProgressProvider, useLearningProgressContext } from './LearningProgressContext'

let progressCallbacks: Array<(event: any) => void> = []

beforeEach(() => {
  progressCallbacks = []
  ;(window as any).api = {
    skill: {
      cancelLearn: vi.fn(async () => ({ cancelled: true })),
      onLearnProgress: vi.fn((cb: (e: any) => void) => { progressCallbacks.push(cb) }),
      offLearnProgress: vi.fn((cb: (e: any) => void) => {
        progressCallbacks = progressCallbacks.filter(c => c !== cb)
      }),
    },
  }
})

function wrapper({ children }: { children: React.ReactNode }) {
  return <LearningProgressProvider>{children}</LearningProgressProvider>
}

describe('LearningProgressContext', () => {
  it('subscribes on mount and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useLearningProgressContext(), { wrapper })
    expect((window as any).api.skill.onLearnProgress).toHaveBeenCalled()
    unmount()
    expect((window as any).api.skill.offLearnProgress).toHaveBeenCalled()
  })

  it('adds an entry when startLearn is called', async () => {
    const { result } = renderHook(() => useLearningProgressContext(), { wrapper })
    await act(async () => {
      // Fire-and-forget; the entry should be added synchronously before fn awaits
      void result.current.startLearn('o', 'n', () => new Promise(() => {}))
    })
    expect(result.current.states.get('o/n')).toEqual(
      expect.objectContaining({ phase: 'cloning', percent: 0, state: 'running' }),
    )
  })

  it('updates state when an IPC progress event arrives', async () => {
    const { result } = renderHook(() => useLearningProgressContext(), { wrapper })
    await act(async () => {
      void result.current.startLearn('o', 'n', () => new Promise(() => {}))
    })
    act(() => {
      progressCallbacks[0]({
        owner: 'o', name: 'n', phase: 'generating', percent: 60, elapsedMs: 1000, state: 'running',
      })
    })
    expect(result.current.states.get('o/n')).toEqual(
      expect.objectContaining({ phase: 'generating', percent: 60 }),
    )
  })

  it('drops the entry 5 seconds after a terminal event', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useLearningProgressContext(), { wrapper })
    await act(async () => {
      void result.current.startLearn('o', 'n', () => new Promise(() => {}))
    })
    act(() => {
      progressCallbacks[0]({
        owner: 'o', name: 'n', phase: 'persisting', percent: 100, elapsedMs: 5000, state: 'completed',
      })
    })
    expect(result.current.states.get('o/n')).toBeDefined()
    act(() => { vi.advanceTimersByTime(5001) })
    expect(result.current.states.get('o/n')).toBeUndefined()
    vi.useRealTimers()
  })

  it('cancelLearn invokes the IPC', async () => {
    const { result } = renderHook(() => useLearningProgressContext(), { wrapper })
    await act(async () => { await result.current.cancelLearn('o', 'n') })
    expect((window as any).api.skill.cancelLearn).toHaveBeenCalledWith('o', 'n')
  })

  it('startLearn passes through fn return value', async () => {
    const { result } = renderHook(() => useLearningProgressContext(), { wrapper })
    let resolved: unknown
    await act(async () => {
      resolved = await result.current.startLearn('o', 'n', async () => ({ cancelled: true } as const))
    })
    expect(resolved).toEqual({ cancelled: true })
  })
})
