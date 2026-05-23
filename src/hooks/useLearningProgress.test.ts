import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { useLearningProgress, formatElapsed } from './useLearningProgress'
import { MockLearningProgressProvider } from '../contexts/LearningProgressContext'

beforeEach(() => {
  ;(window as any).api = { skill: { cancelLearn: vi.fn() } }
})

describe('useLearningProgress', () => {
  it('returns null when no entry exists', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(MockLearningProgressProvider, null, children)
    const { result } = renderHook(() => useLearningProgress('o', 'n'), { wrapper })
    expect(result.current.state).toBeNull()
  })

  it('returns the entry when present', () => {
    const initial = new Map([['o/n', {
      phase: 'generating' as const, percent: 60, startedAt: Date.now() - 5000,
      elapsedMs: 5000, state: 'running' as const,
    }]])
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(MockLearningProgressProvider, { initialStates: initial }, children)
    const { result } = renderHook(() => useLearningProgress('o', 'n'), { wrapper })
    expect(result.current.state).toEqual(expect.objectContaining({ phase: 'generating', percent: 60 }))
  })

  it('elapsed clock ticks while entry is running', () => {
    vi.useFakeTimers()
    const initial = new Map([['o/n', {
      phase: 'generating' as const, percent: 60, startedAt: Date.now() - 1000,
      elapsedMs: 1000, state: 'running' as const,
    }]])
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(MockLearningProgressProvider, { initialStates: initial }, children)
    const { result } = renderHook(() => useLearningProgress('o', 'n'), { wrapper })
    const first = result.current.elapsedMs
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(first + 900)
    vi.useRealTimers()
  })
})

describe('formatElapsed', () => {
  it('formats seconds-only', () => { expect(formatElapsed(47_000)).toBe('47s') })
  it('formats minutes + seconds', () => { expect(formatElapsed(167_000)).toBe('2m 47s') })
  it('formats hours + minutes + seconds', () => { expect(formatElapsed(3_767_000)).toBe('1h 2m 47s') })
  it('handles zero', () => { expect(formatElapsed(0)).toBe('0s') })
  it('rounds down to nearest second', () => { expect(formatElapsed(47_999)).toBe('47s') })
})
