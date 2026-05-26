import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileTreeKeyboard } from './useFileTreeKeyboard'
import type { VisibleRow } from '../lib/fileTree/types'

const row = (path: string, depth: number = 0, type: 'tree' | 'blob' = 'blob', isExpanded = false): VisibleRow => ({
  path, type, name: path.split('/').pop()!, depth, sha: path + '-sha',
  isExpanded, isFlattened: false,
  level: depth + 1, posInSet: 1, setSize: 1,
})

describe('useFileTreeKeyboard', () => {
  it('arrow down moves focus to next row', () => {
    const rows: VisibleRow[] = [row('a'), row('b'), row('c')]
    const onFocusChange = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'a', selected: new Set(['a']), onFocusChange,
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onFocusChange).toHaveBeenCalledWith('b')
  })

  it('arrow up at the top does nothing', () => {
    const rows: VisibleRow[] = [row('a'), row('b')]
    const onFocusChange = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'a', selected: new Set(['a']), onFocusChange,
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onFocusChange).not.toHaveBeenCalled()
  })

  it('arrow right on a collapsed directory expands it', () => {
    const rows: VisibleRow[] = [row('a', 0, 'tree', false)]
    const onToggleExpand = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'a', selected: new Set(), onFocusChange: vi.fn(),
      onToggleExpand, onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onToggleExpand).toHaveBeenCalledWith('a')
  })

  it('Enter on a file calls onActivate', () => {
    const rows: VisibleRow[] = [row('a')]
    const onActivate = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'a', selected: new Set(), onFocusChange: vi.fn(),
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate,
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('Home jumps to first row', () => {
    const rows: VisibleRow[] = [row('a'), row('b'), row('c')]
    const onFocusChange = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'c', selected: new Set(), onFocusChange,
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'Home', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onFocusChange).toHaveBeenCalledWith('a')
  })

  it('End jumps to last row', () => {
    const rows: VisibleRow[] = [row('a'), row('b'), row('c')]
    const onFocusChange = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'a', selected: new Set(), onFocusChange,
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'End', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onFocusChange).toHaveBeenCalledWith('c')
  })

  it('typing a letter focuses next file starting with that letter', () => {
    const rows: VisibleRow[] = [row('apple'), row('banana'), row('cherry')]
    const onFocusChange = vi.fn()
    const { result } = renderHook(() => useFileTreeKeyboard({
      rows, focused: 'apple', selected: new Set(), onFocusChange,
      onToggleExpand: vi.fn(), onSelect: vi.fn(), onActivate: vi.fn(),
    }))
    act(() => {
      result.current.handleKeyDown({ key: 'b', preventDefault: vi.fn() } as unknown as KeyboardEvent)
    })
    expect(onFocusChange).toHaveBeenCalledWith('banana')
  })
})
