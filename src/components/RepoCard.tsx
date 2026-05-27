import { useState, useEffect, useRef, useMemo, memo } from 'react'
import { type RepoRow } from '../types/repo'
import DitherBackground from './DitherBackground'
import { getSubTypeConfig, getBucketGradient, getBucketColor } from '../config/repoTypeConfig'
import LanguageIcon from './LanguageIcon'

// ── Module-level IPC cache for the user's preferred translation language ─
let _preferredLangPromise: Promise<string> | null = null
function getPreferredLang(): Promise<string> {
  if (!_preferredLangPromise) {
    _preferredLangPromise = window.api.settings.getPreferredLanguage().catch(() => 'en')
  }
  return _preferredLangPromise
}

// ── Format helpers (exported — DiscoverRow re-uses these) ──────────
export function formatCount(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
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
  return text.replace(/:([a-z0-9_]+):/g, (m, code) => EMOJI[code] ?? m)
}

// ── Repo Card ─────────────────────────────────────────────────────
interface RepoCardProps {
  repo: RepoRow
  onNavigate: (path: string) => void
  onOwnerClick?: (owner: string) => void
  onLanguageClick?: (lang: string) => void
  onSubtypeClick?: (subtypeId: string) => void
  typeSub?: string | null
  typeBucket?: string | null
  focused?: boolean
  learnState?: 'UNLEARNED' | 'LEARNING' | 'LEARNED'
}

const RepoCard = memo(function RepoCard({
  repo, onNavigate, onOwnerClick, onLanguageClick, onSubtypeClick,
  typeSub, typeBucket, focused, learnState,
}: RepoCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const starred = !!repo.starred_at

  useEffect(() => {
    if (focused && cardRef.current) {
      cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }
  }, [focused])

  // Description translation
  const [displayDescription, setDisplayDescription] = useState(repo.description ?? '')
  useEffect(() => {
    async function checkAndTranslate() {
      if (!repo.description || repo.description.length < 6) return
      const preferredLang = await getPreferredLang()
      if (repo.translated_description && repo.translated_description_lang === preferredLang) {
        setDisplayDescription(repo.translated_description)
        return
      }
      const scriptLang = await window.api.translate.check(repo.description, preferredLang, 6).catch(() => null)
      if (!scriptLang) return
      const result = await window.api.translate.translate(repo.description, preferredLang).catch(() => null)
      if (!result) return
      setDisplayDescription(result.translatedText)
      if (repo.id) {
        window.api.db.cacheTranslatedDescription(
          repo.id, result.translatedText, preferredLang, scriptLang,
        ).catch(() => {})
      }
    }
    checkAndTranslate()
  }, [repo.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const typeConfig = getSubTypeConfig(typeSub)
  const pillAccent = typeConfig?.accentColor ?? (typeBucket ? getBucketColor(typeBucket) : null)
  const gradient = getBucketGradient(typeConfig?.accentColor ?? getBucketColor(typeBucket))
  const parsedDescription = useMemo(() => parseEmoji(displayDescription), [displayDescription])

  return (
    <div
      ref={cardRef}
      className={`repo-card${focused ? ' kb-focused' : ''}${starred ? ' repo-card-starred' : ''}${learnState === 'LEARNED' ? ' repo-card-learned' : ''}`}
      onClick={() => onNavigate(`/repo/${repo.owner}/${repo.name}`)}
    >
      <div className="repo-card-image">
        <DitherBackground avatarUrl={repo.avatar_url} fallbackGradient={gradient} />
        {repo.language && (
          <span
            className="repo-card-lang-overlay"
            onClick={e => { e.stopPropagation(); onLanguageClick?.(repo.language!) }}
            title={repo.language}
          >
            <LanguageIcon lang={repo.language} size={26} boxed />
          </span>
        )}
      </div>
      <div className="repo-card-body">
        <div className="repo-card-title-block">
          <div className="repo-card-title">{repo.name}</div>
          <button
            type="button"
            className="repo-card-author"
            onClick={e => { e.stopPropagation(); onOwnerClick?.(repo.owner) }}
          >
            by {repo.owner}
          </button>
        </div>
        <div className="repo-card-pill-row">
          {typeConfig && pillAccent && typeSub && (
            <button
              type="button"
              className="repo-card-pill"
              style={{ '--pill-accent': pillAccent } as React.CSSProperties}
              onClick={e => { e.stopPropagation(); onSubtypeClick?.(typeSub) }}
            >
              {typeConfig.icon && (
                <span className="repo-card-pill-icon">
                  <typeConfig.icon size={14} fill="currentColor" />
                </span>
              )}
              {typeConfig.label}
            </button>
          )}
        </div>
        {parsedDescription && (
          <p className="repo-card-description">{parsedDescription}</p>
        )}
      </div>
    </div>
  )
})

export default RepoCard
