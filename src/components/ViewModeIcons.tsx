// src/components/ViewModeIcons.tsx
import type { ViewModeKey } from '../lib/discoverQueries'

export function RecommendedIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="view-mode-icon">
      <path d="M8 2 L9.2 6.2 L13 6.5 L10 9.2 L11 13.5 L8 11 L5 13.5 L6 9.2 L3 6.5 L6.8 6.2Z"/>
    </svg>
  )
}

export function BrowseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="view-mode-icon">
      <rect x="2" y="2" width="5" height="5" rx="1"/>
      <rect x="9" y="2" width="5" height="5" rx="1"/>
      <rect x="2" y="9" width="5" height="5" rx="1"/>
      <rect x="9" y="9" width="5" height="5" rx="1"/>
    </svg>
  )
}

export function LastVisitedIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="view-mode-icon">
      <circle cx="8" cy="8" r="6"/>
      <path d="M8 4.5 V8 L10.5 9.5"/>
    </svg>
  )
}

function AgentsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="view-mode-icon">
      <circle cx="8" cy="5.5" r="2.5"/>
      <path d="M3 13.5 C3 11 5 9.5 8 9.5 C11 9.5 13 11 13 13.5"/>
    </svg>
  )
}

export const VIEW_MODE_ICONS: Record<ViewModeKey, (props: { size?: number }) => JSX.Element> = {
  recommended: RecommendedIcon,
  home: BrowseIcon,
  agents: AgentsIcon,
}
