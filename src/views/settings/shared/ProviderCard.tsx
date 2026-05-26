import type { ReactNode } from 'react'

export type StatusTone = 'green' | 'amber' | 'red' | 'gray'

export type ProviderCardProps = {
  icon: ReactNode
  name: string
  chip: 'API' | 'CLI' | 'MCP'
  description: string
  nameAccessory?: ReactNode
  status?: { tone: StatusTone; text: string }
  children?: ReactNode
  actions?: ReactNode
}

export default function ProviderCard({
  icon,
  name,
  chip,
  description,
  nameAccessory,
  status,
  children,
  actions,
}: ProviderCardProps) {
  return (
    <div className="connector-row">
      <div className="connector-icon">{icon}</div>
      <div className="connector-info" style={{ flex: 1 }}>
        <div className="connector-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {name}
          <span className={`transport-chip ${chip.toLowerCase()}`}>{chip}</span>
          {nameAccessory}
        </div>
        <div className="connector-desc">{description}</div>
        {children && <div style={{ marginTop: 8 }}>{children}</div>}
        {status && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, opacity: 0.75 }}>
            <span className={`status-dot ${status.tone}`} />
            {status.text}
          </div>
        )}
      </div>
      {actions && <div className="connector-actions">{actions}</div>}
    </div>
  )
}
