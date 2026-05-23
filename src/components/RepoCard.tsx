import { useState, useEffect, useLayoutEffect, useRef, useMemo, memo } from 'react'
import { justifyContent, unjustifyContent } from 'tex-linebreak'
import { Plus, Brain } from 'lucide-react'
import { parseTopics, type RepoRow } from '../types/repo'
import type { Anchor } from '../types/recommendation'
import { useLearningProgress } from '../hooks/useLearningProgress'
import DitherBackground from './DitherBackground'
import VerifiedBadge from './VerifiedBadge'
import { getSubTypeConfig, getBucketGradient, getBucketColor } from '../config/repoTypeConfig'
import LanguageIcon from './LanguageIcon'
import VerificationBadge from './VerificationBadge'
import { getViewModeAccent, type ViewModeKey } from '../lib/discoverQueries'
import { getLangColor } from '../lib/languages'

// ── Module-level IPC caches (shared across all card instances) ────
const _orgVerifiedCache = new Map<string, boolean>()
let _preferredLangPromise: Promise<string> | null = null
function getPreferredLang(): Promise<string> {
  if (!_preferredLangPromise) {
    _preferredLangPromise = window.api.settings.getPreferredLanguage().catch(() => 'en')
  }
  return _preferredLangPromise
}

// ── Format helpers ─────────────────────────────────────────────────

export function formatCount(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

function formatAge(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (days < 0) return 'new'
  if (days === 0) return 'today'
  if (days === 1) return '1 day old'
  if (days < 7) return `${days} days old`
  if (days < 30) return `${Math.floor(days / 7)} weeks old`
  return `${Math.floor(days / 30)} months old`
}

export function formatRecency(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const ms = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return 'just now'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(months / 12)}y`
}

// ── Emoji shortcode parser ─────────────────────────────────────────
const EMOJI: Record<string, string> = {
  computer:'💻', gem:'💎', rocket:'🚀', fire:'🔥', zap:'⚡', bulb:'💡',
  wrench:'🔧', hammer:'🔨', tools:'🛠️', package:'📦', electric_plug:'🔌',
  battery:'🔋', satellite:'🛰️', cloud:'☁️', floppy_disk:'💾', cd:'💿',
  snake:'🐍', crab:'🦀', whale:'🐳', elephant:'🐘', robot:'🤖', brain:'🧠',
  microscope:'🔬', telescope:'🔭', dna:'🧬', test_tube:'🧪', abacus:'🧮',
  chart_with_upwards_trend:'📈', bar_chart:'📊', chart:'📊',
  book:'📖', books:'📚', memo:'📝', pencil:'✏️', clipboard:'📋',
  scroll:'📜', card_index:'📇', file_folder:'📁', open_file_folder:'📂',
  star:'⭐', star2:'🌟', sparkles:'✨', tada:'🎉', trophy:'🏆', dart:'🎯',
  checkered_flag:'🏁', medal:'🏅', white_check_mark:'✅', x:'❌',
  warning:'⚠️', construction:'🚧', no_entry:'⛔', shield:'🛡️', lock:'🔒',
  key:'🔑', mag:'🔍', mag_right:'🔍', link:'🔗', globe:'🌐',
  information_source:'ℹ️', question:'❓', exclamation:'❗',
  speech_balloon:'💬', loudspeaker:'📢', bell:'🔔', mailbox:'📬',
  heart:'❤️', green_heart:'💚', blue_heart:'💙', purple_heart:'💜',
  art:'🎨', rainbow:'🌈', seedling:'🌱', herb:'🌿', coffee:'☕',
  wave:'👋', point_right:'👉', arrow_right:'➡️', new:'🆕',
  fast_forward:'⏩', hourglass:'⏳', stopwatch:'⏱️', calendar:'📅',
  desktop_computer:'🖥️', keyboard:'⌨️', mouse:'🖱️', printer:'🖨️',
  iphone:'📱', camera:'📷', video_camera:'📹', tv:'📺',
}
function parseEmoji(text: string): string {
  return text.replace(/:([a-z0-9_]+):/g, (match, code) => EMOJI[code] ?? match)
}

// ── Sub-components ─────────────────────────────────────────────────

const MAX_VISIBLE_TAGS = 3

function CardTags({
  tags, onTagClick, activeTags = [],
}: {
  tags: string[]
  onTagClick: (tag: string) => void
  activeTags?: string[]
}) {
  const visible = tags.slice(0, MAX_VISIBLE_TAGS)
  return (
    <div className="repo-card-tags">
      {visible.map(tag => {
        const isActive = activeTags.includes(tag)
        return (
          <button
            key={tag}
            className={`repo-card-tag${isActive ? ' active' : ''}`}
            onClick={e => { e.stopPropagation(); onTagClick(tag) }}
          >
            <span className="repo-card-tag-text">{tag}</span>
            {!isActive && (
              <span className="repo-card-tag-icon">
                <Plus size={9} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Repo Card ─────────────────────────────────────────────────────
interface RepoCardProps {
  repo: RepoRow
  onNavigate: (path: string) => void
  onTagClick: (tag: string) => void
  onOwnerClick?: (owner: string) => void
  typeSub?: string | null
  typeBucket?: string | null
  activeTags?: string[]
  verificationTier?:      'verified' | 'likely' | null
  verificationSignals?:   string[]
  verificationResolving?: boolean
  focused?: boolean
  viewMode?: ViewModeKey
  anchors?: Anchor[]
  onStar?: (repoId: string, starred: boolean) => void
  onLanguageClick?: (lang: string) => void
  onSubtypeClick?: (subtypeId: string) => void
  learnState?: 'UNLEARNED' | 'LEARNING' | 'LEARNED'
  onLearn?: () => void
}

const RepoCard = memo(function RepoCard({ repo, onNavigate, onTagClick, onOwnerClick, typeSub, typeBucket, verificationTier, verificationSignals, verificationResolving, activeTags, focused, viewMode, anchors, onStar, onLanguageClick, onSubtypeClick, learnState, onLearn }: RepoCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const learningProgress = useLearningProgress(repo.owner, repo.name)
  const isLearning = !!learningProgress.state && learningProgress.state.state === 'running'
  const learnPercent = learningProgress.state?.percent ?? 0

  useEffect(() => {
    if (focused && cardRef.current) {
      cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }
  }, [focused])

  const topics = parseTopics(repo.topics)
  const [isVerified, setIsVerified] = useState(false)
  const [starred, setStarred] = useState(!!repo.starred_at)
  const [starWorking, setStarWorking] = useState(false)

  // Sync if prop changes (e.g. after re-fetch)
  useEffect(() => { setStarred(!!repo.starred_at) }, [repo.starred_at])

  const handleStar = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (starWorking) return
    setStarWorking(true)
    try {
      if (starred) {
        await window.api.github.unstarRepo(repo.owner, repo.name)
        setStarred(false)
        onStar?.(repo.id, false)
      } else {
        await window.api.github.starRepo(repo.owner, repo.name)
        setStarred(true)
        onStar?.(repo.id, true)
      }
    } catch { /* silently ignore */ }
    finally { setStarWorking(false) }
  }

  // Description translation state
  const [displayDescription, setDisplayDescription] = useState(repo.description ?? '')

  const _accentColor = viewMode ? getViewModeAccent(viewMode) : 'var(--accent-light)'

  useEffect(() => {
    if (_orgVerifiedCache.has(repo.owner)) {
      setIsVerified(_orgVerifiedCache.get(repo.owner)!)
      return
    }
    window.api.org.getVerified(repo.owner)
      .then(v => { _orgVerifiedCache.set(repo.owner, !!v); if (v) setIsVerified(true) })
      .catch(() => {})
  }, [repo.owner])

  // Description translation
  useEffect(() => {
    async function checkAndTranslate() {
      if (!repo.description || repo.description.length < 6) return

      const preferredLang = await getPreferredLang()

      // Check SQLite cache first
      if (repo.translated_description && repo.translated_description_lang === preferredLang) {
        setDisplayDescription(repo.translated_description)
        return
      }

      // Check if translation needed
      const scriptLang = await window.api.translate.check(repo.description, preferredLang, 6).catch(() => null)
      if (!scriptLang) return

      // Translate
      const result = await window.api.translate.translate(repo.description, preferredLang).catch(() => null)
      if (!result) return

      setDisplayDescription(result.translatedText)

      // Cache in SQLite
      if (repo.id) {
        window.api.db.cacheTranslatedDescription(
          repo.id,
          result.translatedText,
          preferredLang,
          scriptLang,
        ).catch(() => {})
      }
    }

    checkAndTranslate()
  }, [repo.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const typeConfig = getSubTypeConfig(typeSub)
  const gradient = getBucketGradient(typeConfig?.accentColor ?? getBucketColor(typeBucket))
  const parsedDescription = useMemo(() => parseEmoji(displayDescription), [displayDescription])
  const parsedDescHtml = useMemo(() =>
    parsedDescription.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    [parsedDescription]
  )

  const descRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = descRef.current
    if (!el) return
    const apply = () => {
      try {
        justifyContent(el)
        // Clamp lines where Knuth-Plass had to over-stretch — revert those to
        // natural spacing so they read as ragged-right rather than gappy.
        const maxWs = parseFloat(getComputedStyle(el).fontSize) * 0.38
        el.querySelectorAll<HTMLSpanElement>('span[style*="word-spacing"]').forEach(span => {
          const ws = parseFloat(span.style.wordSpacing)
          if (!isNaN(ws) && ws > maxWs) span.style.wordSpacing = 'normal'
        })
      } catch {}
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => { ro.disconnect(); try { unjustifyContent(el) } catch {} }
  }, [parsedDescHtml])

  const recency = formatRecency(repo.pushed_at)

  return (
    <div
      ref={cardRef}
      className={`repo-card${focused ? ' kb-focused' : ''}${starred ? ' repo-card-starred' : ''}${learnState === 'LEARNED' ? ' repo-card-learned' : ''}`}
      onClick={() => onNavigate(`/repo/${repo.owner}/${repo.name}`)}
    >
      {/* Zone 1: Dithered header with star + learn overlays */}
      <div className="repo-card-dither">
        <DitherBackground avatarUrl={repo.avatar_url} fallbackGradient={gradient} />
        <div className="repo-card-actions">
          <button
            className={`repo-card-badge-br${starred ? ' starred' : ''}`}
            onClick={handleStar}
            disabled={starWorking}
            title={starred ? 'Unstar' : 'Star'}
            aria-label={starred ? 'Unstar' : 'Star'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span>{formatCount(repo.stars)}</span>
          </button>
          <button
            className={`repo-card-badge-learn${learnState === 'LEARNED' ? ' learned' : ''}${isLearning ? ' learning' : ''}`}
            onClick={e => { e.stopPropagation(); onLearn?.() }}
            disabled={learnState === 'LEARNING' || isLearning}
            title={learnState === 'LEARNED' ? 'Learned' : isLearning ? `Learning… ${learnPercent}%` : learnState === 'LEARNING' ? 'Learning…' : 'Learn'}
            aria-label={learnState === 'LEARNED' ? 'Learned' : 'Learn'}
          >
            {(isLearning || learnState === 'LEARNING') ? (
              <span className="spin-ring" style={{ width: 12, height: 12 }} />
            ) : learnState === 'LEARNED' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 12 9 17 20 6" />
              </svg>
            ) : (
              <Brain size={14} />
            )}
            <span>
              {learnState === 'LEARNED' ? 'Learned'
                : isLearning ? `Learning… ${learnPercent}%`
                : learnState === 'LEARNING' ? 'Learning…'
                : 'Learn'}
            </span>
          </button>
        </div>
      </div>

      {/* Zone 2: Info panel */}
      <div className="repo-card-info">
        <div className="repo-card-top">
          {repo.avatar_url && (
            <img className="repo-card-avatar" src={repo.avatar_url} alt="" />
          )}
          <div className="repo-card-top-text">
            <div className="repo-card-name">
              {repo.name}
              <VerificationBadge
                tier={verificationTier ?? null}
                signals={verificationSignals ?? []}
                resolving={verificationResolving}
                size="sm"
                variant="icon"
              />
            </div>
            {displayDescription && (
              <p
                ref={descRef}
                className="repo-card-desc"
                dangerouslySetInnerHTML={{ __html: parsedDescHtml }}
              />
            )}
          </div>
        </div>

        <div className="repo-card-grow" />

        <div className="repo-card-footer">
          <div className="repo-card-footer-left">
            <div className="repo-card-stats">
              {repo.owner && (
                <span
                  className="repo-card-stat repo-card-stat-owner"
                  onClick={e => { e.stopPropagation(); onOwnerClick?.(repo.owner) }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
                  {repo.owner}
                  {isVerified && <VerifiedBadge size={8} />}
                </span>
              )}
              {recency && (
                <span className="repo-card-stat">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  {recency}
                </span>
              )}
            </div>
            {topics.length > 0 && (
              <CardTags
                tags={topics}
                onTagClick={onTagClick}
                activeTags={activeTags}
              />
            )}
          </div>
          <div className="repo-card-footer-badges">
            {repo.language && (
              <span
                className="repo-card-icon-badge"
                style={{ '--badge-color': getLangColor(repo.language), cursor: onLanguageClick ? 'pointer' : undefined } as React.CSSProperties}
                onClick={onLanguageClick ? (e) => { e.stopPropagation(); onLanguageClick(repo.language!) } : undefined}
              >
                <span className="repo-card-icon-badge-icon">
                  <LanguageIcon lang={repo.language} size={18} boxed />
                </span>
                <span className="repo-card-icon-badge-text">{repo.language}</span>
              </span>
            )}
            {typeConfig && typeSub && (
              <span
                className="repo-card-icon-badge"
                style={{ '--badge-color': typeConfig.accentColor, cursor: onSubtypeClick ? 'pointer' : undefined } as React.CSSProperties}
                onClick={onSubtypeClick ? (e) => { e.stopPropagation(); onSubtypeClick(typeSub) } : undefined}
              >
                {typeConfig.icon && (
                  <span className="repo-card-icon-badge-icon">
                    <span className="repo-card-subtype-icon" style={{ backgroundColor: typeConfig.accentColor }}>
                      <typeConfig.icon size={12} fill="currentColor" />
                    </span>
                  </span>
                )}
                <span className="repo-card-icon-badge-text">{typeConfig.label}</span>
              </span>
            )}
          </div>
        </div>
      </div>
      {/* Zone 3: Anchor attribution strip (recommended-mode only) */}
      {viewMode === 'recommended' && anchors && anchors.length > 0 && (
        <div className="repo-card-anchors" onClick={e => e.stopPropagation()}>
          <span className="repo-card-anchors-label">Because you starred</span>
          <div className="repo-card-anchor-chips">
            {anchors.slice(0, 2).map(a => (
              <button
                key={`${a.owner}/${a.name}`}
                type="button"
                className="repo-card-anchor-chip"
                onClick={e => {
                  e.stopPropagation()
                  onNavigate(`/repo/${a.owner}/${a.name}`)
                }}
                title={`${a.owner}/${a.name}`}
              >
                {a.avatar_url && (
                  <img className="repo-card-anchor-avatar" src={a.avatar_url} alt="" />
                )}
                <span className="repo-card-anchor-name">{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

export default RepoCard
