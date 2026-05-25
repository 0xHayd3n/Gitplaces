import React from 'react'

export type AgentModelValue = 'sonnet' | 'opus' | 'haiku' | 'inherit'

interface ModelDropdownProps {
  value: AgentModelValue
  onChange: (next: AgentModelValue) => void
  id?: string
}

export function ModelDropdown({ value, onChange, id }: ModelDropdownProps) {
  return (
    <select
      id={id}
      className="agent-detail-settings-select"
      value={value}
      onChange={e => onChange(e.target.value as AgentModelValue)}
    >
      <option value="inherit">Inherit (Claude Code default)</option>
      <option value="sonnet">Sonnet</option>
      <option value="opus">Opus</option>
      <option value="haiku">Haiku</option>
    </select>
  )
}
