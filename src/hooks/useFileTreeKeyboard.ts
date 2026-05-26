import { useCallback, useRef } from 'react'
import type { VisibleRow } from '../lib/fileTree/types'

interface UseFileTreeKeyboardInput {
  rows: VisibleRow[]
  focused: string | null
  selected: Set<string>
  onFocusChange: (path: string) => void
  onToggleExpand: (path: string) => void
  onSelect: (path: string, opts: { shift: boolean; ctrl: boolean }) => void
  onActivate: (path: string) => void
}

interface UseFileTreeKeyboardResult {
  handleKeyDown(e: KeyboardEvent | React.KeyboardEvent): void
}

const TYPE_TO_FOCUS_TIMEOUT_MS = 1000

export function useFileTreeKeyboard(input: UseFileTreeKeyboardInput): UseFileTreeKeyboardResult {
  const typeBuffer = useRef<{ chars: string; timer: number | null }>({ chars: '', timer: null })

  const handleKeyDown = useCallback((e: KeyboardEvent | React.KeyboardEvent) => {
    const { rows, focused, onFocusChange, onToggleExpand, onActivate } = input
    if (rows.length === 0) return

    const idx = focused ? rows.findIndex(r => r.path === focused) : -1
    const current = idx >= 0 ? rows[idx] : null

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        if (idx < rows.length - 1) onFocusChange(rows[idx + 1].path)
        return
      }
      case 'ArrowUp': {
        e.preventDefault()
        if (idx > 0) onFocusChange(rows[idx - 1].path)
        return
      }
      case 'ArrowRight': {
        e.preventDefault()
        if (current?.type === 'tree') {
          if (!current.isExpanded) {
            onToggleExpand(current.path)
          } else if (idx + 1 < rows.length && rows[idx + 1].depth > current.depth) {
            onFocusChange(rows[idx + 1].path)
          }
        }
        return
      }
      case 'ArrowLeft': {
        e.preventDefault()
        if (current?.type === 'tree' && current.isExpanded) {
          onToggleExpand(current.path)
        } else if (current && current.depth > 0) {
          for (let i = idx - 1; i >= 0; i--) {
            if (rows[i].depth < current.depth) {
              onFocusChange(rows[i].path)
              break
            }
          }
        }
        return
      }
      case 'Enter': {
        e.preventDefault()
        if (current) onActivate(current.path)
        return
      }
      case ' ': {
        e.preventDefault()
        if (current?.type === 'tree') onToggleExpand(current.path)
        return
      }
      case 'Home': {
        e.preventDefault()
        onFocusChange(rows[0].path)
        return
      }
      case 'End': {
        e.preventDefault()
        onFocusChange(rows[rows.length - 1].path)
        return
      }
    }

    if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key) && !('ctrlKey' in e && (e.ctrlKey || e.metaKey))) {
      e.preventDefault()
      const buf = typeBuffer.current
      if (buf.timer) clearTimeout(buf.timer)
      buf.chars = (buf.chars + e.key).toLowerCase()
      buf.timer = window.setTimeout(() => { buf.chars = ''; buf.timer = null }, TYPE_TO_FOCUS_TIMEOUT_MS)
      const start = idx >= 0 ? idx + 1 : 0
      for (let offset = 0; offset < rows.length; offset++) {
        const i = (start + offset) % rows.length
        if (rows[i].name.toLowerCase().startsWith(buf.chars)) {
          onFocusChange(rows[i].path)
          return
        }
      }
    }
  }, [input])

  return { handleKeyDown }
}
