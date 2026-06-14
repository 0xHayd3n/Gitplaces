import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import Toggle from './Toggle'
import DetailRow from './DetailRow'
import SkillDepthBars from './SkillDepthBars'
import AnatomyIndicators from './AnatomyIndicators'
import { getLangConfig } from './BannerSVG'
import { formatDate, daysSince } from '../utils/dateHelpers'
import { useProfileOverlay } from '../contexts/ProfileOverlay'
import type { LibrarySavedRepo, SubSkillRow, AnatomyPayload } from '../types/repo'

export default function GenericDetail({
  row, collections, onToggle, onRegenerate, onEnhance, onRemove, regenerating, componentsSubSkill, versionedInstalls,
}: {
  row: LibrarySavedRepo
  collections: { id: string; name: string }[]
  onToggle: (active: boolean) => void
  onRegenerate: () => void
  onEnhance: () => void
  onRemove: () => void
  regenerating: boolean
  componentsSubSkill: SubSkillRow | null
  versionedInstalls: string[]
}) {
  const [skillContent, setSkillContent] = useState<string | null>(null)
  const [anatomy, setAnatomy] = useState<AnatomyPayload | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.skill.getContent(row.owner, row.name).then(result => {
      if (!cancelled && result) setSkillContent(result.content)
    })
    return () => { cancelled = true }
  }, [row.owner, row.name])

  useEffect(() => {
    let cancelled = false
    window.api.skill.getAnatomy(row.owner, row.name)
      .then(p => { if (!cancelled) setAnatomy(p) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [row.owner, row.name])

  const lang = row.language ?? ''
  const cfg = getLangConfig(lang)
  const skillSizeKb = ((skillContent?.length ?? 0) / 1024).toFixed(1)
  const collectionsStr = collections.length > 0 ? collections.map(c => c.name).join(', ') : '\u2014'
  const { openProfile } = useProfileOverlay()
  const navigate = useNavigate()

  return (
    <>
      {/* Header */}
      <div className="lib-detail-header">
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
          <Toggle on={row.active === 1} onChange={onToggle} ariaLabel="Toggle skill active" />
        </div>
      </div>

      {/* Body */}
      <div className="lib-detail-body">
        {/* Skill file section */}
        <div className="lib-skill-panel">
          <div className="lib-skill-panel-header">
            <span className="lib-skill-panel-filename">{row.name}.skill.md</span>
            <span className="lib-skill-panel-status-ok">{'\u2713'} current</span>
          </div>
          <div className="lib-skill-panel-body">
            {anatomy
              ? <AnatomyIndicators payload={anatomy} updateAvailable={(row.updateAvailable ?? 0) as number} />
              : <SkillDepthBars content={skillContent ?? ''} />}
            <p className="lib-skill-note">
              Generated from v{row.version ?? '\u2014'} {'\u00B7'} {row.generatedAt ? daysSince(row.generatedAt) : '\u2014'}
            </p>
          </div>
        </div>

        {/* Details */}
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

        {/* Actions */}
        <div className="lib-actions">
          <button className="lib-btn-regen" onClick={onRegenerate} disabled={regenerating}>
            {regenerating ? '\u27F3 Regenerating\u2026' : '\u21BA Regenerate'}
          </button>
          {(row.tier ?? 1) < 2 && (
            <button className="btn-enhance" onClick={onEnhance} disabled={regenerating}>
              Enhance
            </button>
          )}
          <button className="lib-btn-remove" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </>
  )
}
