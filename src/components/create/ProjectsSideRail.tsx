import './ProjectsSideRail.css'

export type SideRailTab = 'recent' | 'archive'

interface Props {
  activeTab: SideRailTab
  onTabChange: (tab: SideRailTab) => void
}

function RecentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5z" />
    </svg>
  )
}

const TABS: { id: SideRailTab; icon: React.ReactNode; label: string }[] = [
  { id: 'recent',  icon: <RecentIcon />,  label: 'Recent' },
  { id: 'archive', icon: <ArchiveIcon />, label: 'Archive' },
]

export default function ProjectsSideRail({ activeTab, onTabChange }: Props) {
  return (
    <div className="projects-side-rail">
      {TABS.map(({ id, icon, label }) => (
        <div key={id} className="projects-side-rail-btn-wrap">
          <button
            type="button"
            className={`projects-side-rail-btn${activeTab === id ? ' active' : ''}`}
            onClick={() => { if (activeTab !== id) onTabChange(id) }}
            title={label}
            aria-label={label}
          >
            {icon}
          </button>
          {activeTab === id && <div className="projects-side-rail-indicator" />}
        </div>
      ))}
    </div>
  )
}
