import { type ReactNode } from 'react'
import './DiscoverRow.css'

interface DiscoverRowSlot<T> {
  item: T
  posIndex: number
}

interface DiscoverRowProps<T> {
  items: T[]
  activeIndex: number
  columns: number
  getItemKey: (item: T) => string
  renderCard: (slot: DiscoverRowSlot<T> & { columns: number; visible: number }) => ReactNode
  onAdvance: (delta: number) => void
  title?: string
  onMore?: () => void
  onPause?: (paused: boolean) => void
}

export default function DiscoverRow<T>({
  items, activeIndex, columns, getItemKey, renderCard,
  onAdvance, title = 'Recommended for You', onMore, onPause,
}: DiscoverRowProps<T>) {
  if (items.length === 0) return null

  const visible = Math.min(columns, items.length)
  const slots: DiscoverRowSlot<T>[] = Array.from({ length: visible }, (_, i) => ({
    item: items[(activeIndex + i) % items.length],
    posIndex: i,
  }))

  if (items.length > visible) {
    slots.unshift({
      item: items[(activeIndex - 1 + items.length) % items.length],
      posIndex: -1,
    })
  }
  if (items.length >= visible + 2) {
    slots.push({
      item: items[(activeIndex + visible) % items.length],
      posIndex: visible,
    })
  }

  const atStart = activeIndex === 0
  const atEnd = activeIndex >= Math.max(0, items.length - visible)

  return (
    <div className="discover-row">
      <div className="discover-row-header">
        {onMore ? (
          <button className="discover-row-title-btn" onClick={onMore} aria-label={`See all ${title}`}>
            <span>{title}</span>
            <span className="discover-row-title-chevron" aria-hidden="true">›</span>
          </button>
        ) : (
          <span className="discover-row-title-static">{title}</span>
        )}
      </div>
      <div
        className="discover-row-carousel"
        onMouseEnter={() => onPause?.(true)}
        onMouseLeave={() => onPause?.(false)}
      >
        {slots.map(({ item, posIndex }) => (
          <div key={getItemKey(item)} style={{ display: 'contents' }}>
            {renderCard({ item, posIndex, columns, visible })}
          </div>
        ))}
        <button
          className="discover-row-nav-zone discover-row-nav-zone--prev"
          onClick={() => onAdvance(-1)}
          disabled={atStart}
          aria-label="Previous"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          className="discover-row-nav-zone discover-row-nav-zone--next"
          onClick={() => onAdvance(1)}
          disabled={atEnd}
          aria-label="Next"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  )
}
