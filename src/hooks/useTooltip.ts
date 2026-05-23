import { useEffect, useRef } from 'react'

// Cursor-following tooltip that updates the DOM directly — no React state,
// so moving the mouse over interactive elements (which all have `title`
// attributes) doesn't re-render the whole app tree. Positions via `transform`
// to avoid the layout-invalidation hit of writing `left`/`top` every frame.
export function useTooltip() {
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const currentText = useRef<string | null>(null)
  const lastOwner = useRef<Element | null>(null)
  const cachedDims = useRef({ width: 0, height: 0 })

  const pendingX = useRef(0)
  const pendingY = useRef(0)
  const pendingTarget = useRef<Element | null>(null)
  const framePending = useRef(false)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      pendingX.current = e.clientX
      pendingY.current = e.clientY
      pendingTarget.current = e.target as Element | null

      if (framePending.current) return
      framePending.current = true

      requestAnimationFrame(() => {
        framePending.current = false
        const el = nodeRef.current
        if (!el) return

        const x = pendingX.current
        const y = pendingY.current
        const target = pendingTarget.current

        // Resolve the new tooltip owner (if any). Fast path: still inside the
        // previous owner's subtree → text stays the same, skip DOM lookups.
        let newText: string | null = currentText.current
        if (!target) {
          lastOwner.current = null
          newText = null
        } else if (!lastOwner.current?.contains(target)) {
          const owner = target.closest('[title],[data-tooltip]') as Element | null
          if (owner) {
            const title = owner.getAttribute('title')
            if (title) {
              owner.setAttribute('data-tooltip', title)
              owner.removeAttribute('title')
            }
            newText = owner.getAttribute('data-tooltip')
            lastOwner.current = owner
          } else {
            lastOwner.current = null
            newText = null
          }
        }

        if (newText !== currentText.current) {
          currentText.current = newText
          if (newText) {
            el.textContent = newText
            el.style.opacity = '1'
            // Measure once per text change; cache for subsequent positioning.
            const rect = el.getBoundingClientRect()
            cachedDims.current = { width: rect.width, height: rect.height }
          } else {
            el.style.opacity = '0'
          }
        }

        // Position via transform only (no layout invalidation per frame).
        const { width, height } = cachedDims.current
        const vw = window.innerWidth
        const margin = 8
        const flipX = x + 10 + width > vw - margin
        const flipY = y - height < margin
        const tx = flipX ? x - width - 10 : x + 10
        const ty = flipY ? y + 16 : y - height
        el.style.transform = `translate(${tx}px, ${ty}px)`
      })
    }

    document.addEventListener('mousemove', onMove, { passive: true })
    return () => document.removeEventListener('mousemove', onMove)
  }, [])

  return { nodeRef }
}
