import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, AlertTriangle } from 'lucide-react'
import Toggle from './Toggle'
import DetailRow from './DetailRow'
import SkillDepthBars from './SkillDepthBars'
import { getLangConfig } from './BannerSVG'
import { formatDate, daysSince } from '../utils/dateHelpers'
import { charSizeKb, countLines } from '../utils/textStats'
import { useProfileOverlay } from '../contexts/ProfileOverlay'
import type { LibrarySavedRepo, SubSkillRow } from '../types/repo'
import type { McpScanResult } from '../types/mcp'

export interface MCPToolsDetailProps {
  row: LibrarySavedRepo
  collections: { id: string; name: string }[]
  activeTab: 'tools' | 'skill' | 'details'
  onTabChange: (t: 'tools' | 'skill' | 'details') => void
  toolSearch: string
  onToolSearchChange: (v: string) => void
  scanResult: McpScanResult | null
  onRescan: () => void
  onToggleTool: (name: string) => void
  onSelectAll: () => void
  onRebuild: () => void
  onToggleActive: (v: boolean) => void
  onEnhance: () => void
  regenerating: boolean
  mcpToolsSubSkill: SubSkillRow | null
  versionedInstalls: string[]
}

export default function MCPToolsDetail({
  row, collections, activeTab, onTabChange, toolSearch, onToolSearchChange,
  scanResult, onRescan, onToggleTool, onSelectAll, onRebuild,
  onToggleActive, onEnhance, regenerating, mcpToolsSubSkill, versionedInstalls,
}: MCPToolsDetailProps) {
  const [skillContent, setSkillContent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.skill.getContent(row.owner, row.name).then(result => {
      if (!cancelled && result) setSkillContent(result.content)
    })
    return () => { cancelled = true }
  }, [row.owner, row.name])

  const lang = row.language ?? ''
  const cfg  = getLangConfig(lang)
  const { openProfile } = useProfileOverlay()
  const navigate = useNavigate()

  const enabledNames: string[] | null = row.enabledTools
    ? (() => { try { return JSON.parse(row.enabledTools!) as string[] } catch { return null } })()
    : null
  const enabledSet = enabledNames ? new Set(enabledNames) : null
  const tools = scanResult?.tools ?? []
  const isEnabled = (name: string) => enabledSet === null ? true : enabledSet.has(name)
  const enabledCount = enabledSet === null ? tools.length : enabledNames!.length
  const totalCount   = tools.length

  const filtered = tools.filter(t => t.name.toLowerCase().includes(toolSearch.toLowerCase()))
  const categories = Array.from(new Set(filtered.map(t => t.category ?? '(uncategorized)')))
  const skillSizeKb = charSizeKb(skillContent)
  const collectionsStr = collections.length > 0 ? collections.map(c => c.name).join(', ') : '\u2014'
  const skillLineCount = countLines(skillContent)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="lib-comp-header">
        <div className="lib-comp-header-top">
          <div className="lib-detail-lang" style={{ background: cfg.bg, color: cfg.primary }}>
            {cfg.abbr}
          </div>
          <div className="lib-detail-title-block">
            <div className="lib-detail-title">{row.name}</div>
            <button
              className="owner-name-btn lib-detail-owner"
              onClick={(e) => { e.stopPropagation(); openProfile(row.owner) }}
            >
              {row.owner}
            </button>
            {(row.tier ?? 1) >= 2 && <span className="badge-enhanced">Enhanced</span>}
          </div>
          <div className="lib-detail-active-row">
            <button
              className="lib-btn-view-repo"
              onClick={() => navigate(`/repo/${row.owner}/${row.name}`)}
              title="View repo"
            >
              <ExternalLink size={13} />
            </button>
            <span className="lib-detail-active-label">Active</span>
            <Toggle on={row.active === 1} onChange={onToggleActive} ariaLabel="Toggle skill active" />
          </div>
        </div>
        <span className="lib-comp-type-pill">MCP server</span>
        <p className="lib-comp-count-line">
          {enabledCount} of {totalCount} enabled {'\u00B7'} skill file {skillLineCount} lines
        </p>
        <div className="lib-comp-tabs">
          {(['tools', 'skill', 'details'] as const).map(t => (
            <button
              key={t}
              className={`lib-comp-tab${activeTab === t ? ' active' : ''}`}
              onClick={() => onTabChange(t)}
            >
              {t === 'tools' ? 'Tools' : t === 'skill' ? 'Skill file' : 'Details'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'tools' && (
        <>
          {scanResult === null ? (
            <div style={{ padding: 16 }}>
              <p style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 12 }}>
                Tools have not been scanned yet.
              </p>
              <button className="lib-comp-rebuild-btn" onClick={onRescan}>Scan tools</button>
            </div>
          ) : (
            <>
              {scanResult.source === 'readme-approx' && (
                <div className="mcp-warning-banner" role="alert">
                  <AlertTriangle size={12} />
                  <span>Tools extracted from README &mdash; may be incomplete or out of date.</span>
                </div>
              )}

              <div className="lib-comp-toolbar">
                <input
                  className="lib-comp-search"
                  placeholder="Search tools\u2026"
                  value={toolSearch}
                  onChange={(e) => onToolSearchChange(e.target.value)}
                />
                <span className="lib-comp-count-text">{enabledCount} / {totalCount}</span>
                <button className="lib-comp-select-all" onClick={onSelectAll}>Select all</button>
                <button className="lib-comp-select-all" onClick={onRescan} title="Rescan tools">
                  {'\u21BB'} Rescan
                </button>
              </div>

              <div className="lib-comp-body">
                {categories.map(cat => {
                  const catTools = filtered.filter(t => (t.category ?? '(uncategorized)') === cat)
                  if (catTools.length === 0) return null
                  return (
                    <div key={cat}>
                      <div className="lib-comp-category-label">{cat}</div>
                      <div className="mcp-tools-list">
                        {catTools.map(tool => {
                          const on = isEnabled(tool.name)
                          return (
                            <div
                              key={tool.name}
                              className={`mcp-tool-card${on ? ' active' : ' inactive'}`}
                              onClick={() => onToggleTool(tool.name)}
                            >
                              <div className="mcp-tool-card-body">
                                <span className="mcp-tool-name">{tool.name}</span>
                                {tool.description && <p className="mcp-tool-desc">{tool.description}</p>}
                              </div>
                              <Toggle on={on} onChange={() => onToggleTool(tool.name)} mini ariaLabel={`Toggle ${tool.name} tool`} />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {tools.length === 0 && (
                  <p style={{ fontSize: 10, color: 'var(--t2)', padding: '8px 0' }}>
                    No MCP tools detected in this repo.
                  </p>
                )}
              </div>

              <div className="lib-comp-footer">
                <span className="lib-comp-footer-note">Skill file reflects enabled tools</span>
                {(row.tier ?? 1) < 2 && (
                  <button className="btn-enhance" onClick={onEnhance} disabled={regenerating}>Enhance</button>
                )}
                <button className="lib-comp-rebuild-btn" onClick={onRebuild} disabled={regenerating}>
                  {regenerating ? '\u27F3 Rebuilding\u2026' : '\u21BA Rebuild skill'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {activeTab === 'skill' && (
        <div className="lib-detail-body">
          <div className="lib-skill-panel">
            <div className="lib-skill-panel-header">
              <span className="lib-skill-panel-filename">{row.name}.skill.md</span>
              <span className="lib-skill-panel-status-ok">{'\u2713'} current</span>
            </div>
            <div className="lib-skill-panel-body">
              <SkillDepthBars content={skillContent ?? ''} />
              <p className="lib-skill-note">
                Generated from v{row.version ?? '\u2014'} {'\u00B7'} {row.generatedAt ? daysSince(row.generatedAt) : '\u2014'}
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'details' && (
        <div className="lib-detail-body">
          <div className="lib-details-section">
            <span className="lib-details-label">Details</span>
            <DetailRow k="Saved"          v={formatDate(row.savedAt)} />
            <DetailRow k="Repo version"   v={row.version ?? '\u2014'} />
            <DetailRow k="Skill size"     v={`${skillSizeKb} KB`} />
            <DetailRow k="Language"       v={row.language ?? '\u2014'} />
            <DetailRow k="License"        v={row.license ?? '\u2014'} />
            <DetailRow k="In collections" v={collectionsStr} />
          </div>
          {(mcpToolsSubSkill || versionedInstalls.length > 0) && (
            <div className="lib-details-section">
              <span className="lib-details-label">Sub-skills</span>
              {mcpToolsSubSkill && (
                <DetailRow
                  k="MCP tools"
                  v={`${scanResult?.source ?? '\u2014'} \u00B7 ${mcpToolsSubSkill.generated_at ? daysSince(mcpToolsSubSkill.generated_at) : '\u2014'}`}
                />
              )}
              {versionedInstalls.map(tag => (
                <DetailRow key={tag} k="Version" v={tag} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
