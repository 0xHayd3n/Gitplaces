import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import Toggle from './Toggle'
import DetailRow from './DetailRow'
import SkillDepthBars from './SkillDepthBars'
import ComponentPreview from './ComponentPreview'
import { getLangConfig } from './BannerSVG'
import { formatDate, daysSince } from '../utils/dateHelpers'
import { parseComponents, type ComponentEntry } from '../utils/skillParse'
import { useProfileOverlay } from '../contexts/ProfileOverlay'
import type { LibrarySavedRepo, SubSkillRow } from '../types/repo'

export default function ComponentDetail({
  row, collections, activeTab, onTabChange, componentSearch, onComponentSearchChange,
  onToggleComponent, onSelectAll, onRebuild, onToggleActive, onEnhance, regenerating,
  componentsSubSkill, versionedInstalls,
}: {
  row: LibrarySavedRepo
  collections: { id: string; name: string }[]
  activeTab: 'components' | 'skill' | 'details'
  onTabChange: (t: 'components' | 'skill' | 'details') => void
  componentSearch: string
  onComponentSearchChange: (v: string) => void
  onToggleComponent: (name: string) => void
  onSelectAll: () => void
  onRebuild: () => void
  onToggleActive: (v: boolean) => void
  onEnhance: () => void
  regenerating: boolean
  componentsSubSkill: SubSkillRow | null
  versionedInstalls: string[]
}) {
  const [skillContent, setSkillContent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.skill.getContent(row.owner, row.name).then(result => {
      if (!cancelled && result) setSkillContent(result.content)
    })
    return () => { cancelled = true }
  }, [row.owner, row.name])

  const lang = row.language ?? ''
  const cfg = getLangConfig(lang)
  const { openProfile } = useProfileOverlay()
  const navigate = useNavigate()
  const allComponents: ComponentEntry[] = parseComponents(skillContent ?? '')
  const enabledNames: string[] | null = row.enabledComponents
    ? (() => { try { return JSON.parse(row.enabledComponents!) as string[] } catch { return null } })()
    : null
  const enabledSet = enabledNames ? new Set(enabledNames) : null
  const isEnabled = (name: string) => enabledSet === null ? true : enabledSet.has(name)
  const enabledCount = enabledSet === null ? allComponents.length : enabledNames!.length
  const totalCount = allComponents.length
  const skillSizeKb = ((skillContent?.length ?? 0) / 1024).toFixed(1)
  const collectionsStr = collections.length > 0 ? collections.map(c => c.name).join(', ') : '\u2014'
  const skillLineCount = (skillContent ?? '').split('\n').length

  // Group by category
  const categories = Array.from(new Set(allComponents.map((c) => c.category)))
  const filtered = allComponents.filter((c) =>
    c.name.toLowerCase().includes(componentSearch.toLowerCase())
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
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
            {(row.tier ?? 1) >= 2 && (
              <span className="badge-enhanced">Enhanced</span>
            )}
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
        <span className="lib-comp-type-pill">component library</span>
        <p className="lib-comp-count-line">
          {enabledCount} of {totalCount} enabled {'\u00B7'} skill file {skillLineCount} lines
        </p>
        <div className="lib-comp-tabs">
          {(['components', 'skill', 'details'] as const).map((t) => (
            <button
              key={t}
              className={`lib-comp-tab${activeTab === t ? ' active' : ''}`}
              onClick={() => onTabChange(t)}
            >
              {t === 'components' ? 'Components' : t === 'skill' ? 'Skill file' : 'Details'}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'components' && (
        <>
          <div className="lib-comp-toolbar">
            <input
              className="lib-comp-search"
              placeholder="Search components\u2026"
              value={componentSearch}
              onChange={(e) => onComponentSearchChange(e.target.value)}
            />
            <span className="lib-comp-count-text">{enabledCount} / {totalCount}</span>
            <button className="lib-comp-select-all" onClick={onSelectAll}>Select all</button>
          </div>

          <div className="lib-comp-body">
            {categories.map((cat) => {
              const catComps = filtered.filter((c) => c.category === cat)
              if (catComps.length === 0) return null
              return (
                <div key={cat}>
                  <div className="lib-comp-category-label">{cat}</div>
                  <div className="lib-comp-grid">
                    {catComps.map((comp) => {
                      const on = isEnabled(comp.name)
                      return (
                        <div
                          key={comp.name}
                          className={`lib-comp-card ${on ? 'active' : 'inactive'}`}
                          onClick={() => onToggleComponent(comp.name)}
                        >
                          <span className="lib-comp-card-name">{comp.name}</span>
                          <div className="lib-comp-preview">
                            <ComponentPreview name={comp.name} />
                          </div>
                          <Toggle on={on} onChange={() => onToggleComponent(comp.name)} mini ariaLabel={`Toggle ${comp.name} component`} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {allComponents.length === 0 && (
              <p style={{ fontSize: 10, color: 'var(--t2)', padding: '8px 0' }}>
                No components found in skill file.
              </p>
            )}
          </div>

          <div className="lib-comp-footer">
            <span className="lib-comp-footer-note">Skill file reflects enabled components</span>
            {(row.tier ?? 1) < 2 && (
              <button className="btn-enhance" onClick={onEnhance} disabled={regenerating}>
                Enhance
              </button>
            )}
            <button className="lib-comp-rebuild-btn" onClick={onRebuild} disabled={regenerating}>
              {regenerating ? '\u27F3 Rebuilding\u2026' : '\u21BA Rebuild skill'}
            </button>
          </div>
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
          {/* Sub-skills */}
          {(componentsSubSkill || versionedInstalls.length > 0) && (
            <div className="lib-details-section">
              <span className="lib-details-label">Sub-skills</span>
              {componentsSubSkill && (
                <DetailRow
                  k="Components"
                  v={`${componentsSubSkill.filename} \u00B7 ${componentsSubSkill.generated_at ? daysSince(componentsSubSkill.generated_at) : '\u2014'}`}
                />
              )}
              {versionedInstalls.map((tag) => (
                <DetailRow key={tag} k="Version" v={tag} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
