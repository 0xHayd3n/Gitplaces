import React from 'react'

export const STANDARD_CC_TOOLS = [
  'Read', 'Write', 'Edit',
  'Glob', 'Grep',
  'Bash',
  'WebFetch', 'WebSearch',
  'Task',
  'TodoWrite',
  'NotebookEdit',
  'ExitPlanMode',
] as const

interface ToolsPickerProps {
  value: string[] | null            // null = inherit; [] = no tools; array = restrict
  onChange: (next: string[] | null) => void
}

export function ToolsPicker({ value, onChange }: ToolsPickerProps) {
  const restrict = value !== null
  const checked = new Set(value ?? [])

  const customTools = (value ?? []).filter(t => !(STANDARD_CC_TOOLS as readonly string[]).includes(t))

  const toggleRestrict = (next: boolean) => {
    onChange(next ? [] : null)
  }

  const toggleTool = (tool: string) => {
    const current = value ?? []
    onChange(current.includes(tool)
      ? current.filter(t => t !== tool)
      : [...current, tool])
  }

  return (
    <div className="agent-detail-tools-picker">
      <label className="agent-detail-tools-radio">
        <input
          type="radio"
          name="tools-mode"
          checked={!restrict}
          onChange={() => toggleRestrict(false)}
        />
        <span>Inherit all (no restriction)</span>
      </label>
      <label className="agent-detail-tools-radio">
        <input
          type="radio"
          name="tools-mode"
          checked={restrict}
          onChange={() => toggleRestrict(true)}
        />
        <span>Restrict to:</span>
      </label>
      {restrict && (
        <div className="agent-detail-tools-grid">
          {STANDARD_CC_TOOLS.map(tool => (
            <label key={tool} className="agent-detail-tools-checkbox">
              <input
                type="checkbox"
                checked={checked.has(tool)}
                onChange={() => toggleTool(tool)}
              />
              <span>{tool}</span>
            </label>
          ))}
          {customTools.length > 0 && (
            <div className="agent-detail-tools-custom">
              <div className="agent-detail-tools-custom-label">Custom (from import):</div>
              {customTools.map(tool => (
                <label key={tool} className="agent-detail-tools-checkbox">
                  <input
                    type="checkbox"
                    checked={checked.has(tool)}
                    onChange={() => toggleTool(tool)}
                  />
                  <span>{tool}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
