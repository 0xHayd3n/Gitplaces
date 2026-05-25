import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue, lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'
import { PiBrainFill, PiGitBranchFill, PiStarFill, PiStar, PiGitForkFill } from 'react-icons/pi'
import { useParams, useNavigate } from 'react-router-dom'
import {
  SiGithub, SiDiscord, SiSlack, SiTelegram, SiReddit,
  SiYoutube, SiTwitch, SiInstagram, SiFacebook,
  SiPatreon, SiMastodon,
} from 'react-icons/si'
import { getLangConfig } from '../components/BannerSVG'
import { getLangColor } from '../lib/languages'
import { classifyRepoBucket } from '../lib/classifyRepoType'
import { getSubTypeConfig, getBucketGradient, getBucketColor } from '../config/repoTypeConfig'
import DitherBackground from '../components/DitherBackground'
import { cameraIdxForRepo } from '../utils/repoCameraSeed'
const ReadmeRenderer = lazy(() => import('../components/ReadmeRenderer'))
import TocNav, { type TocItem } from '../components/TocNav'
import NavBar from '../components/NavBar'
import LanguageIcon from '../components/LanguageIcon'
import logoTransparent from '../assets/logo-transparent.png'
import { useSavedRepos } from '../contexts/SavedRepos'
import { useArchivedRepos } from '../hooks/useArchivedRepos'
import { parseTopics, formatStars, type RepoRow, type ReleaseRow, type SkillRow, type SubSkillRow, type AnatomyPayload } from '../types/repo'
import AnatomyIndicators from '../components/AnatomyIndicators'
import AnatomyView from '../components/AnatomyView'
import AnatomyMemoryPanel from '../components/AnatomyMemoryPanel'
import { parseSkillDepths } from '../utils/skillParse'
import { useProfileOverlay } from '../contexts/ProfileOverlay'
import { useAppearance } from '../contexts/Appearance'
import { useLearningProgressContext } from '../contexts/LearningProgressContext'
import { useLearningProgress } from '../hooks/useLearningProgress'
import { PrimaryActionSplitButton } from '../components/PrimaryActionSplitButton'
import ImportPluginDialog from '../components/ImportPluginDialog'
import { LearnStatusInline } from '../components/LearnStatusInline'
import { formatCount } from '../components/RepoCard'
import {
  extractBadges,
  getBadgeText,
  getSocialPlatform,
  PLATFORM_LABELS,
  type ParsedBadge,
} from '../utils/badgeParser'
import {
  extractYouTubeLinks,
  fetchYouTubeOEmbed,
  type YouTubeLink,
  type YouTubeVideoData,
} from '../utils/youtubeParser'
import {
  extractSocialPosts,
  type SocialPostLink,
} from '../utils/socialParser'
import { extractCommands, type CommandBlock } from '../utils/commandParser'
// websiteParser import removed — website links are now shown in the README's References section
import { BannerCard, type BannerCardProps } from '../components/BannerCard'
import { releaseToBannerProps } from '../components/ActivityEvent'
import { classifyRelease } from '../utils/classifyRelease'
import { ActivityModal } from '../components/ActivityModal'
import { DateDivider } from '../components/DateDivider'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import { useRepoUserEvents } from '../hooks/useRepoUserEvents'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import { groupRepoActivityByDay } from '../utils/groupRepoActivityByDay'
import { RepoUserEventRow } from '../components/RepoUserEventRow'
import RepoNotes from '../components/RepoNotes'
import { useRepoStats } from '../hooks/useRepoStats'
import { computeHealthScore } from '../lib/healthScore'
import { RepoStatsSidebar } from '../components/RepoStatsSidebar'
import type { RepoActivityItem } from '../types/repoActivity'
import FilesTab from '../components/FilesTab'
import { useRepoNav } from '../contexts/RepoNav'
const StorybookExplorer = lazy(() => import('../components/StorybookExplorer'))
const ComponentExplorer = lazy(() => import('../components/ComponentExplorer'))
import { isComponentLibraryRepo } from '../utils/componentLibraryDetector'
import { getCachedScan, performComponentScan } from '../utils/componentScan'
import VerificationBadge from '../components/VerificationBadge'
import { useVerification } from '../hooks/useVerification'
import CloneOptionsPanel from '../components/CloneOptionsPanel'
import { ArticleLayout } from '../components/ArticleLayout'

// ── Inline SVG icons for platforms react-icons/si doesn't cover ────────────
function XTwitterIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  )
}
function LinkedInIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  )
}
function BskyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 360 320" fill="currentColor">
      <path d="M180 142c-16.3-31.7-60.7-90.8-102-120C38 0 0 0 0 66c0 12 1.7 72 28 98 28.4 28.4 64.7 16.8 100.7-2.8C104.5 191 64 214.8 64 254c0 45.3 35.3 66 64 66s48-24.3 52-66.7C184 296 188 320 216 320s64-20.7 64-66c0-39.2-40.5-63-64.7-90.8C251.3 182.8 287.6 194.4 316 166c26.3-26 28-86 28-98C344 0 306 0 282 22c-41.3 29.2-85.7 88.3-102 120z"/>
    </svg>
  )
}
function KoFiIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z"/>
    </svg>
  )
}
function OpenCollectiveIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="currentColor">
      <path d="M32.9 20c0 2.2-.6 4.4-1.6 6.3l4.8 4.8C38.4 27.7 40 23.9 40 20s-1.6-7.7-3.9-11.1l-4.8 4.8c1 1.9 1.6 4.1 1.6 6.3z"/>
      <path d="M20 32.9c-7.1 0-12.9-5.8-12.9-12.9S12.9 7.1 20 7.1c2.2 0 4.4.6 6.3 1.6l4.8-4.8C27.7 1.6 23.9 0 20 0 9 0 0 9 0 20s9 20 20 20c3.9 0 7.7-1.1 11.1-3.3l-4.8-4.8c-1.9 1-4.1 1.6-6.3 1.6v.4z"/>
    </svg>
  )
}

// ── Social platform icon map ────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PLATFORM_ICONS: Record<string, React.ComponentType<any>> = {
  twitter:           XTwitterIcon,
  github:            SiGithub,
  'github-sponsors': SiGithub,
  sponsor:           SiGithub,
  discord:           SiDiscord,
  slack:             SiSlack,
  telegram:          SiTelegram,
  reddit:            SiReddit,
  youtube:           SiYoutube,
  twitch:            SiTwitch,
  instagram:         SiInstagram,
  facebook:          SiFacebook,
  patreon:           SiPatreon,
  mastodon:          SiMastodon,
  linkedin:          LinkedInIcon,
  bluesky:           BskyIcon,
  donate:            KoFiIcon,
  opencollective:    OpenCollectiveIcon,
}

function SocialIcon({ badge }: { badge: ParsedBadge }) {
  const platform = getSocialPlatform(badge.linkUrl)
  const Icon     = platform ? PLATFORM_ICONS[platform] : null
  const label    = platform ? (PLATFORM_LABELS[platform] ?? platform) : (badge.alt || (badge.linkUrl ?? ''))

  const inner = Icon
    ? <Icon size={14} />
    : (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/>
        <path d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/>
      </svg>
    )

  return (
    <a
      href={badge.linkUrl ?? undefined}
      className="sidebar-social-icon"
      title={label}
      onClick={e => { e.preventDefault(); badge.linkUrl && window.api.openExternal(badge.linkUrl) }}
    >
      {inner}
    </a>
  )
}

// ── Themed badge pill ───────────────────────────────────────────────
export function valueAccent(value: string): 'green' | 'red' | 'blue' | 'gray' {
  const v = value.toLowerCase()
  if (/\b(passing|passed|enabled|active|success|yes|valid|up|stable|secured)\b/.test(v)) return 'green'
  // 'unknown' intentionally omitted — multi-word values like "unknown status" should be neutral gray
  if (/\b(failing|failure|failed|error|no|invalid|down|critical)\b/.test(v))     return 'red'
  if (/^v?\d/.test(v.trim())) return 'blue'
  return 'gray'
}

function BadgePill({ badge }: { badge: ParsedBadge }) {
  const { label, value } = getBadgeText(badge)
  const display = value || label
  if (!display || display === '?') return null
  const accent = valueAccent(display)

  return (
    <a
      href={badge.linkUrl ?? undefined}
      className="sidebar-badge-pill"
      style={{ cursor: badge.linkUrl ? 'pointer' : 'default' }}
      title={label ? `${label}: ${value}` : value}
      onClick={e => { e.preventDefault(); badge.linkUrl && window.api.openExternal(badge.linkUrl) }}
    >
      {label && value && <span className="sbp-label">{label}</span>}
      <span className={`sbp-value sbp-value--${accent}`}>
        {display}
      </span>
    </a>
  )
}

// ── Command block card (Commands tab) ───────────────────────────────────────
function CommandBlockCard({ block }: { block: CommandBlock }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(block.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="cmd-block">
      {block.label && (
        <div className="cmd-label">{block.label}</div>
      )}
      <div className="cmd-code-wrap">
        <pre className="cmd-code">{block.code}</pre>
        <button
          className={`cmd-copy-btn${copied ? ' copied' : ''}`}
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy to clipboard'}
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
              <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Language switcher detection ────────────────────────────────────
// Maps common language labels used in README switcher bars to BCP-47 codes
const LABEL_TO_LANG: Record<string, string> = {
  english: 'en', en: 'en',
  chinese: 'zh', '简体中文': 'zh', '中文': 'zh', zh: 'zh', '繁體中文': 'zh-TW',
  japanese: 'ja', '日本語': 'ja', ja: 'ja',
  korean: 'ko', '한국어': 'ko', ko: 'ko',
  russian: 'ru', 'русский': 'ru', ru: 'ru',
  french: 'fr', français: 'fr', fr: 'fr',
  german: 'de', deutsch: 'de', de: 'de',
  spanish: 'es', español: 'es', es: 'es',
  portuguese: 'pt', português: 'pt', pt: 'pt',
  italian: 'it', italiano: 'it', it: 'it',
  arabic: 'ar', 'العربية': 'ar', ar: 'ar',
  hindi: 'hi', 'हिन्दी': 'hi', hi: 'hi',
  turkish: 'tr', türkçe: 'tr', tr: 'tr',
  vietnamese: 'vi', tiếng_việt: 'vi', vi: 'vi',
  indonesian: 'id', bahasa_indonesia: 'id', id: 'id',
}

/**
 * Scans the first ~50 lines of a README for a language switcher bar.
 * Returns a map of lang-code → repo-relative file path for all detected links.
 * e.g. { en: 'en/README.md', ja: 'README_JA.md' }
 *
 * Handles both formats:
 *   - Markdown: [English](docs/README_EN.md)
 *   - HTML:     <a href="https://github.com/owner/repo/blob/main/en/README.md">English</a>
 */
function detectLangSwitcher(raw: string, repoOwner: string, repoName: string): Record<string, string> {
  const lines = raw.split('\n').slice(0, 50).join('\n')
  const result: Record<string, string> = {}

  // GitHub blob URL prefix for this repo — used to extract relative paths
  const blobPrefix = `https://github.com/${repoOwner}/${repoName}/blob/`

  // Helper: resolve a URL/path to a repo-relative path (or null if not applicable)
  function toRepoPath(href: string): string | null {
    const trimmed = href.trim()
    if (trimmed.startsWith(blobPrefix)) {
      // e.g. https://github.com/owner/repo/blob/main/en/README.md → en/README.md
      const afterBlob = trimmed.slice(blobPrefix.length) // "main/en/README.md"
      const slashIdx = afterBlob.indexOf('/')
      return slashIdx >= 0 ? afterBlob.slice(slashIdx + 1) : null
    }
    // Relative path — keep as-is (skip other external URLs)
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return null
    return trimmed || null
  }

  // Helper: look up a label string in the language map
  function resolveLabel(label: string): string | null {
    const normalized = label.trim().toLowerCase().replace(/\s+/g, '_')
    return LABEL_TO_LANG[normalized] ?? LABEL_TO_LANG[label.trim()] ?? null
  }

  // Pattern 1: HTML <a href="...">Label</a>
  const htmlRe = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = htmlRe.exec(lines)) !== null) {
    const path = toRepoPath(m[1])
    const lang = resolveLabel(m[2])
    if (path && lang) result[lang] = path
  }

  // Pattern 2: Markdown [Label](path)
  const mdRe = /\[([^\]]+)\]\(([^)]+)\)/g
  while ((m = mdRe.exec(lines)) !== null) {
    const path = toRepoPath(m[2])
    const lang = resolveLabel(m[1])
    if (path && lang && !result[lang]) result[lang] = path
  }

  return result
}

// ── Language names for translation indicator ───────────────────────
const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  ru: 'Russian', ar: 'Arabic',  hi: 'Hindi',
  fr: 'French',  de: 'German',  es: 'Spanish',
  pt: 'Portuguese', it: 'Italian', nl: 'Dutch',
  pl: 'Polish',  tr: 'Turkish', vi: 'Vietnamese',
  id: 'Indonesian', sv: 'Swedish',
}

// ── Format helpers ─────────────────────────────────────────────────
function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatSize(kb: number | null): string {
  if (kb == null) return '—'
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb.toLocaleString()} KB`
}

function formatLicense(license: string | null | undefined): string | null {
  if (!license) return null
  if (license === 'NOASSERTION') return null
  if (license.startsWith('LicenseRef-')) return null
  return license
}

function daysAgoLabel(iso: string | null): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  return `${days} days ago`
}

// ── Skill utilities ────────────────────────────────────────────────
type LearnState = 'UNLEARNED' | 'LEARNING' | 'LEARNED'

// ── Skill file tab renderer ────────────────────────────────────────
const SECTION_COLORS: Record<string, string> = {
  '## [CORE]':       '#059669',
  '## [EXTENDED]':   '#6d28d9',
  '## [DEEP]':       '#4c1d95',
  '## [COMPONENTS]': '#0891b2',  // cyan — component library sub-skill
  '## [SKILLS]':     '#64748b',  // muted slate — index/directory marker
}

function SkillFileContent({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)
  const lines = content.split('\n')

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="skill-file-wrap">
      <button
        className={`skill-file-copy-btn${copied ? ' copied' : ''}`}
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
            <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
          </svg>
        )}
      </button>
      <pre className="skill-file-pre">
        {lines.map((line, i) => {
          const trimmed = line.trim()
          const color = SECTION_COLORS[trimmed] ??
            Object.entries(SECTION_COLORS).find(([key]) => trimmed.startsWith(key + ' '))?.[1]
          return (
            <span key={i} style={color ? { color, fontWeight: 600 } : undefined}>
              {line}{'\n'}
            </span>
          )
        })}
      </pre>
    </div>
  )
}

// ── Sidebar primitives ─────────────────────────────────────────────
function SidebarLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'Inter, sans-serif',
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--t3)',
      textTransform: 'uppercase',
      letterSpacing: '0.07em',
      marginBottom: 8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      {children}
      {action}
    </div>
  )
}

// ── Tab IDs ────────────────────────────────────────────────────────
type Tab = 'activities' | 'readme' | 'files' | 'skill' | 'collections' | 'related' | 'videos' | 'posts' | 'commands' | 'components'
const ALL_TABS: { id: Tab; label: string }[] = [
  { id: 'activities',  label: 'Activities' },
  { id: 'readme',      label: 'Readme' },
  { id: 'components',  label: 'Components' },
  { id: 'files',       label: 'Files' },
  { id: 'skill',       label: 'Skills Folder' },
  { id: 'collections', label: 'Collections' },
  { id: 'related',     label: 'Related' },
  { id: 'videos',      label: 'Videos' },
  { id: 'posts',       label: 'Posts' },
  { id: 'commands',    label: 'Commands' },
]

// ── Synthetic ReleaseEvent adapter ─────────────────────────────────
// Maps a ReleaseRow (from getReleases) into the GitHubFeedEvent shape that
// BannerCard / ActivityModal expect, so the Activities tab can reuse the same
// presentation pieces as the Library feed without a parallel rendering path.
// actor.login/avatar_url are empty: BannerCard derives the card avatar from
// repo.full_name, and ActivityModalEntry computes bylineActor but never
// displays it. ReleaseRow has no author field, so we can't populate them.
export function releaseRowToFeedEvent(r: ReleaseRow, repoFullName: string): GitHubFeedEvent {
  return {
    id: `release-${r.tag_name}`,
    type: 'ReleaseEvent',
    actor: { login: '', avatar_url: '' },
    repo: { full_name: repoFullName },
    payload: {
      release: {
        tag_name: r.tag_name,
        name: r.name,
        body: r.body,
        prerelease: r.prerelease,
        assets: r.assets,
      },
    },
    created_at: r.published_at,
  }
}

// ── Per-repo data cache (survives navigations in the same session) ──
interface CachedRepoEntry {
  repo: RepoRow
  readme: string | null
  cleanedReadme: string
  displayReadme: string
  cleanedDisplayReadme: string
  readmeBadges: ParsedBadge[]
}
const _repoCache = new Map<string, Partial<CachedRepoEntry>>()
function patchRepoCache(key: string, patch: Partial<CachedRepoEntry>) {
  _repoCache.set(key, { ..._repoCache.get(key), ...patch })
}

// Seed the cache from rows already in memory (e.g. the Library sidebar's
// installedRows + starredRows). Lets RepoDetail render the header band,
// description, and stats sidebar immediately on first navigation instead of
// waiting for fetchRepoBundle to resolve. The live fetch still runs and
// overwrites, so any drift between the cached row and the live response is
// resolved within one round-trip.
export function primeRepoCacheFromRows(rows: ReadonlyArray<RepoRow>) {
  for (const row of rows) {
    patchRepoCache(`${row.owner}/${row.name}`, { repo: row })
  }
}

// ── Module-level session caches for endpoints that don't merit their own
// SQLite-backed cache but ARE worth skipping on a same-session revisit. Each
// entry is invalidated by writes (e.g., `_starredCache.delete()` on (un)star).
// 5-minute TTL is enough to cover "browse around then come back" flows
// without serving stale data for very long.
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000

const _releasesCache     = new Map<string, { value: ReleaseRow[]; ts: number }>()
const _starredCache      = new Map<string, { value: boolean;       ts: number }>()
// Caches only the boolean answer "does this repo have importable agent
// content?" (skills / sub-agents / slash commands). We don't cache the full
// RepoPluginIndex — its descriptions/colors are only needed once the import
// dialog opens, which re-fetches from scratch.
const _pluginIndexCache  = new Map<string, { value: boolean;       ts: number }>()
// Test-only seam: these module-singleton caches persist for the process
// lifetime (intentional in-app session caching). Tests that mount RepoDetail
// for the same owner/name share a cacheKey, so without a reset one test's
// cached repo/releases/starred state leaks into the next. Inert in production.
export function __resetRepoDetailCaches(): void {
  _repoCache.clear()
  _releasesCache.clear()
  _starredCache.clear()
  _pluginIndexCache.clear()
}
function readSessionCache<T>(map: Map<string, { value: T; ts: number }>, key: string): T | undefined {
  const entry = map.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.ts >= SESSION_CACHE_TTL_MS) { map.delete(key); return undefined }
  return entry.value
}
function writeSessionCache<T>(map: Map<string, { value: T; ts: number }>, key: string, value: T): void {
  map.set(key, { value, ts: Date.now() })
}

export default function RepoDetail() {
  const { owner, name } = useParams<{ owner: string; name: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const inLibrary = location.pathname.startsWith('/library/')
  const flavour = inLibrary ? 'library' as const : 'domain' as const
  const { saveRepo } = useSavedRepos()
  const { openProfile } = useProfileOverlay()
  const { invertDarkImages } = useAppearance()
  const verification = useVerification()
  const repoNav = useRepoNav()
  const [seedTier, setSeedTier]       = useState<'verified' | 'likely' | null>(null)
  const [seedSignals, setSeedSignals] = useState<string[]>([])

  const [repo, setRepo] = useState<RepoRow | null>(null)
  const [repoError, setRepoError] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('activities')
  const [filesTargetPath, setFilesTargetPath] = useState<string | null>(null)
  const fellBackRef = useRef(false)
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null)

  // TOC panel state + refs (shared with ArticleLayout, ReadmeRenderer, and TocNav)
  const [tocHeadings, setTocHeadings] = useState<TocItem[]>([])
  const readmeBodyRef   = useRef<HTMLDivElement>(null)
  const articleBodyRef  = useRef<HTMLDivElement>(null)
  const bodyContentRef  = useRef<HTMLDivElement>(null)
  const handleTocReady = useCallback((headings: TocItem[]) => setTocHeadings(headings), [])

  const [readme, setReadme] = useState<string | null | 'loading' | 'error'>('loading')
  const [displayReadme, setDisplayReadme] = useState('')
  const [readmeFetched, setReadmeFetched] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [readmeTranslated, setReadmeTranslated] = useState(false)
  const [readmeDetectedLang, setReadmeDetectedLang] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [readmeBadges, setReadmeBadges] = useState<ParsedBadge[]>([])
  const [cleanedReadme, setCleanedReadme] = useState<string>('')
  const [cleanedDisplayReadme, setCleanedDisplayReadme] = useState<string>('')
  const [releases, setReleases] = useState<ReleaseRow[] | 'loading' | 'error'>('loading')
  const [versionedLearns, setVersionedLearns] = useState<Set<string>>(new Set())
  const [versionLearnStates, setVersionLearnStates] = useState<Map<string, 'UNLEARNED' | 'LEARNING' | 'LEARNED' | 'ERROR'>>(new Map())
  const [related, setRelated] = useState<RepoRow[]>([])
  // Memoised synthetic events for the Activities tab; rebuilt only when the
  // releases data or the repo identity changes. Still used as the `events`
  // prop on <ActivityModal> for stacked navigation through release modals.
  const activityEvents = useMemo(
    () => Array.isArray(releases)
      ? (releases as ReleaseRow[]).map(r => releaseRowToFeedEvent(r, `${owner}/${name}`))
      : [],
    [releases, owner, name],
  )
  // User-action events (star / archive / fork / learn) recorded locally by
  // write IPCs; merged with releases below to form the unified Activities feed.
  const userEvents = useRepoUserEvents(owner, name)
  const lastReleaseDate = Array.isArray(releases) && releases.length > 0
    ? (releases as ReleaseRow[])[0].published_at
    : null
  // Stats fetches once per repo (no `lastReleaseDate` dep). When releases
  // later resolve, we recompute the release-affected score components in
  // `enrichedRepoStats` below — no second network round-trip.
  // Stats sidebar is only rendered on the Activities tab — defer the
  // IPC until the user is actually there. Activities is the default tab so
  // most users still trigger this on first load; users who deep-link to
  // another tab don't pay for stats they never see.
  const rawRepoStats = useRepoStats(owner, name, activeTab === 'activities')
  const repoStats = useMemo(() => {
    if (rawRepoStats === 'loading' || rawRepoStats === 'error') return rawRepoStats
    if (lastReleaseDate === null || rawRepoStats.health.daysSinceCommit === undefined) {
      // Either there are no releases yet (or they failed) or this is a stats
      // payload from before `daysSinceCommit` was exposed — leave score as-is.
      return rawRepoStats
    }
    const lastReleaseDaysAgo = Math.floor(
      (Date.now() - new Date(lastReleaseDate).getTime()) / 86_400_000,
    )
    const score = computeHealthScore({
      daysSinceCommit: rawRepoStats.health.daysSinceCommit,
      openIssues: rawRepoStats.vitals.openIssues,
      lastReleaseDaysAgo,
    })
    return {
      ...rawRepoStats,
      health: { ...rawRepoStats.health, score, lastReleaseDate, lastReleaseDaysAgo },
    }
  }, [rawRepoStats, lastReleaseDate])
  const { user: authedUser } = useGitHubAuth()
  const userLogin = authedUser?.login ?? ''
  const userAvatarUrl = userLogin ? `https://avatars.githubusercontent.com/${userLogin}?s=64` : ''

  // Merge releases + user events into a single sorted list, then day-group.
  const repoActivityItems = useMemo<RepoActivityItem[]>(() => {
    const items: RepoActivityItem[] = []
    if (Array.isArray(releases)) {
      for (const r of releases as ReleaseRow[]) {
        const ev = releaseRowToFeedEvent(r, `${owner}/${name}`)
        items.push({ kind: 'release', ts: ev.created_at, event: ev })
      }
    }
    if (Array.isArray(userEvents)) {
      for (const u of userEvents) items.push({ kind: 'user', ts: u.ts, event: u })
    }
    return items.sort((a, b) => b.ts.localeCompare(a.ts))
  }, [releases, userEvents, owner, name])

  const repoActivityGroups = useMemo(
    () => groupRepoActivityByDay(repoActivityItems),
    [repoActivityItems],
  )
  // The most recent major release (v1.0.0, v2.0.0, …) gets pinned as FEATURED
  // at the top of the Activities tab and is removed from the regular timeline.
  const featuredActivityItem = useMemo(() => {
    for (const item of repoActivityItems) {
      if (item.kind !== 'release') continue
      const release = (item.event.payload as { release: { tag_name: string; prerelease?: boolean | null } }).release
      const tier = classifyRelease({ tagName: release.tag_name, prereleaseFlag: release.prerelease === true })
      if (tier === 'major') return item
    }
    return null
  }, [repoActivityItems])

  // Stable callback for opening a release modal — memoized once so memoized
  // BannerCards don't re-render every time the parent does.
  const handleOpenRelease = useCallback((event: GitHubFeedEvent) => {
    setSelectedReleaseId(event.id)
  }, [])

  // Compute BannerCard props once per release.id. Two wins: stripMarkdownPreview
  // only runs when the underlying items change (not on every parent render),
  // and the prop object reference is stable so React.memo on BannerCard keeps
  // unchanged cards from re-rendering.
  const bannerPropsByEventId = useMemo(() => {
    const map = new Map<string, BannerCardProps>()
    for (const item of repoActivityItems) {
      if (item.kind === 'release') {
        map.set(item.event.id, releaseToBannerProps(item.event, handleOpenRelease))
      }
    }
    return map
  }, [repoActivityItems, handleOpenRelease])

  // Pre-filter the featured release out of the timeline groups (was inline in
  // render). Hides empty groups too.
  const displayedActivityGroups = useMemo(() => {
    const featuredId = featuredActivityItem?.event.id
    if (!featuredId) return repoActivityGroups
    return repoActivityGroups
      .map(g => ({
        ...g,
        items: g.items.filter(item => !(item.kind === 'release' && item.event.id === featuredId)),
      }))
      .filter(g => g.items.length > 0)
  }, [repoActivityGroups, featuredActivityItem])
  // First-resolve fallback: if BOTH releases and user events come back empty/error,
  // drop from the optimistic 'activities' default to README. The ref ensures we
  // only apply the fallback once — subsequent navigations to Activities by the
  // user stick.
  useEffect(() => {
    if (fellBackRef.current) return
    if (releases === 'loading' || userEvents === 'loading') return
    fellBackRef.current = true
    const hasActivity = (Array.isArray(releases) && (releases as ReleaseRow[]).length > 0)
                     || (Array.isArray(userEvents) && userEvents.length > 0)
    if (!hasActivity && activeTab === 'activities') setActiveTab('readme')
  }, [releases, userEvents, activeTab])
  const [repoCols, setRepoCols] = useState<{ id: string; name: string }[]>([])

  // Learn state
  const [learnState, setLearnState] = useState<LearnState>('UNLEARNED')
  const [learnError, setLearnError] = useState<'no-key' | 'failed' | null>(null)
  const { startLearn } = useLearningProgressContext()
  const learnProgress = useLearningProgress(owner ?? '', name ?? '')
const [skillRow, setSkillRow] = useState<SkillRow | null>(null)
  const [anatomyPayload, setAnatomyPayload] = useState<AnatomyPayload | null>(null)
  const [componentsSkillRow, setComponentsSkillRow] = useState<SubSkillRow | null>(null)
  const [selectedSkillFile, setSelectedSkillFile] = useState<string>('master')
  const [relearningTarget, setRelearningTarget] = useState<'master' | 'components' | null>(null)
  const [hoveredBox, setHoveredBox] = useState<'master' | 'components' | null>(null)
  const [cloneOpen, setCloneOpen] = useState<boolean>(() => {
    // Honour `navigate(path, { state: { openClone: true } })` from the sidebar context menu.
    const s = location.state as { openClone?: boolean } | null
    return s?.openClone === true
  })
  const [importAgentOpen, setImportAgentOpen] = useState(false)
  // Gates the "Import to agent library…" menu item. canImportAgents goes true
  // only once discoverPluginInRepo confirms importable content. While the scan
  // is in-flight, isDetectingAgents is true so the dropdown can show a disabled
  // "Scanning for agents…" placeholder — lets the user see the import path is
  // being checked rather than wondering if the option exists at all.
  const [canImportAgents, setCanImportAgents] = useState(false)
  const [isDetectingAgents, setIsDetectingAgents] = useState(true)

  // Video state
  const [videoLinks, setVideoLinks]   = useState<YouTubeLink[]>([])
  const [videoData,  setVideoData]    = useState<YouTubeVideoData[]>([])
  const [videosFetched, setVideosFetched] = useState(false)

  // Social posts state
  const [socialPosts, setSocialPosts] = useState<SocialPostLink[]>([])

  // Website links state
  // websiteLinks state removed — external links now displayed in README References section

  // Commands state
  const [commands,  setCommands]  = useState<CommandBlock[]>([])

  // Storybook / Components tab state
  // 'detecting' while IPC call is in-flight; string = confirmed URL; null = not found
  const [storybookState, setStorybookState] = useState<'detecting' | string | null>('detecting')
  const [storybookReadmeScanned, setStorybookReadmeScanned] = useState(false)
  const isComponentLibrary = useMemo(
    () => isComponentLibraryRepo(parseTopics(repo?.topics ?? null), repo?.description ?? null),
    [repo?.topics, repo?.description]
  )

  // Star state
  const [starred, setStarred] = useState(false)
  const [starWorking, setStarWorking] = useState(false)

  // Archive state
  const { archivedSet, toggle: archiveToggle } = useArchivedRepos()
  const archived = owner && name ? archivedSet.has(`${owner}/${name}`) : false

  // ── Publish active tab + callbacks to NavBar via context ──
  useEffect(() => {
    repoNav.setActiveTab(activeTab)
  }, [activeTab])

  // Clear TOC headings when leaving the README tab so stale headings don't flash on return
  useEffect(() => {
    if (activeTab !== 'readme') setTocHeadings([])
  }, [activeTab])

  useEffect(() => {
    repoNav.setOnTabClick(() => (tab: string) => {
      setActiveTab(tab as Tab)
    })
    return () => {
      repoNav.setActiveTab(null)
      repoNav.setFilePath(null)
      repoNav.setOnTabClick(null)
      repoNav.setOnFilePathClick(null)
      repoNav.setFileNav(null)
    }
  }, [])

  // Reset + fetch on route change
  useEffect(() => {
    if (!owner || !name) return

    // Cancellation guard: when the route changes (or React StrictMode unmounts
    // and remounts the component in dev), the in-flight fetches from the
    // previous run must NOT overwrite state that belongs to the new repo.
    // Without this, a stale fetch resolving after a successful new fetch can
    // wipe valid data — e.g. a stale `setReleases('error')` clobbering a fresh
    // `setReleases([data])`, leaving the Activities tab showing only the
    // user-events fallback (such as the lone "created" event).
    let cancelled = false

    const cacheKey = `${owner}/${name}`
    const cached = _repoCache.get(cacheKey)

    // Seed from cache immediately so the UI shows content on revisit without a flash
    setRepo(cached?.repo ?? null)
    setStarred(cached?.repo ? !!cached.repo.starred_at : false)
    setReadme(cached && 'readme' in cached ? (cached.readme as string | null) : 'loading')
    setDisplayReadme(cached?.displayReadme ?? '')
    setCleanedReadme(cached?.cleanedReadme ?? '')
    setCleanedDisplayReadme(cached?.cleanedDisplayReadme ?? '')
    setReadmeBadges(cached?.readmeBadges ?? [])

    // Always reset ephemeral/derived state
    setRepoError(false)
    setReadmeFetched(false)
    setTranslating(false)
    setReadmeTranslated(false)
    setReadmeDetectedLang(null)
    setShowOriginal(false)
    setVideoLinks([])
    setVideoData([])
    setVideosFetched(false)
    setSocialPosts([])
    setCommands([])
    setStorybookState('detecting')
    setStorybookReadmeScanned(false)
    setReleases('loading')
    // Pre-mark the deferred-releases ref so the deferred effect (which runs
    // on the same first render with activeTab='activities') sees that a fetch
    // is already underway via the bundle and bails. Without this, both fired
    // in parallel on every cold load.
    //
    // Ordering note: this effect must run BEFORE the deferred-releases effect
    // for the pre-mark to be visible. React fires effects in declaration
    // order within a component, and this main effect is declared before
    // the deferred-releases effect (~line 944), so the ordering holds. If
    // either effect is ever reordered, the deferred one will race.
    //
    // The null-bundle fallback below and the deferred effect itself both
    // clear the ref on error so a tab switch back to Activities can retry.
    releasesFetchedRef.current = cacheKey
    setRelated([])
    setRepoCols([])
    setLearnState('UNLEARNED')
    setLearnError(null)
    setSkillRow(null)
    setComponentsSkillRow(null)
    setSelectedSkillFile('master')
    // Default to 'activities' (shows release feed); fellBackRef effect will
    // demote to 'readme' if releases resolves empty/error. Reset the ref so
    // the demotion runs again for the new repo.
    fellBackRef.current = false
    setActiveTab('activities')

    // Phase 4H — bundled GraphQL fetch. One round-trip replaces the separate
    // getRepo + getReleases + isStarred REST calls. On failure we degrade
    // gracefully to the per-endpoint IPCs (which themselves still benefit from
    // ETag and DB caches from Phases 2-3).
    window.api.github.fetchRepoBundle(owner, name)
      .then((bundle) => {
        if (cancelled) return
        if (!bundle) {
          // GraphQL failed (no token, network error, etc.) — fall back to
          // per-endpoint REST. github:getRepo handles its own DB upsert.
          window.api.github.getRepo(owner, name)
            .then(row => {
              if (cancelled) return
              if (!row) { setRepoError(true); return }
              setRepo(row)
              patchRepoCache(cacheKey, { repo: row })
              setStarred(!!row.starred_at)
              window.api.verification.getScore(row.id)
                .then(s => { if (!cancelled && s) { setSeedTier(s.tier); setSeedSignals(s.signals) } })
                .catch(() => {})
              window.api.github.getRelatedRepos(owner, name, row.topics ?? '[]')
                .then(items => { if (!cancelled) setRelated(items) })
                .catch(() => {})
            })
            .catch(() => { if (!cancelled) setRepoError(true) })
          // Fallback live star check — only if session cache doesn't have it.
          if (readSessionCache(_starredCache, cacheKey) === undefined) {
            window.api.github.isStarred(owner, name)
              .then(s => {
                if (cancelled) return
                setStarred(s)
                writeSessionCache(_starredCache, cacheKey, s)
              })
              .catch(() => {})
          }
          // Fallback releases fetch — bundle didn't return them. Mirrors the
          // deferred effect's logic. Session cache is checked first so a
          // re-mount from cache stays free. On any error path we clear
          // releasesFetchedRef so a tab switch back to Activities can retry
          // (otherwise the pre-mark at the top of this effect would block
          // forever within the session).
          const cachedReleases = readSessionCache(_releasesCache, cacheKey)
          if (cachedReleases !== undefined) {
            setReleases(cachedReleases)
          } else {
            window.api.github.getReleases(owner, name)
              .then(r => {
                if (cancelled) return
                if (r === null) {
                  setReleases('error')
                  releasesFetchedRef.current = null
                } else {
                  setReleases(r)
                  writeSessionCache(_releasesCache, cacheKey, r)
                }
              })
              .catch(() => {
                if (!cancelled) {
                  setReleases('error')
                  releasesFetchedRef.current = null
                }
              })
          }
          return
        }
        // Bundle hit — one GraphQL call satisfies repo + releases + starred.
        const row = bundle.repoRow
        if (!row) { setRepoError(true); return }
        setRepo(row)
        patchRepoCache(cacheKey, { repo: row })
        setStarred(bundle.isStarred)
        writeSessionCache(_starredCache, cacheKey, bundle.isStarred)
        // Releases from the bundle pre-populates state and the session cache —
        // the deferred-releases effect below will see the cache and skip its
        // own fetch.
        setReleases(bundle.releases)
        writeSessionCache(_releasesCache, cacheKey, bundle.releases)
        releasesFetchedRef.current = cacheKey
        window.api.verification.getScore(row.id)
          .then(s => { if (!cancelled && s) { setSeedTier(s.tier); setSeedSignals(s.signals) } })
          .catch(() => {})
        window.api.github.getRelatedRepos(owner, name, row.topics ?? '[]')
          .then(items => { if (!cancelled) setRelated(items) })
          .catch(() => {})
      })
      .catch(() => { if (!cancelled) setRepoError(true) })

    // Releases are deferred to a tab-gated effect below — only fetched once
    // the user is actually on the Activities tab. Saves one GitHub call when
    // the user navigates straight to README/Files/etc.

    window.api.skill.getVersionedInstalls(owner, name)
      .then(refs => { if (!cancelled) setVersionedLearns(new Set(refs)) })
      .catch(() => {})

    window.api.skill.get(owner, name)
      .then(async (row) => {
        if (cancelled || !row) return
        setSkillRow(row)
        setLearnState('LEARNED')
        const compRow = await window.api.skill.getSubSkill(owner, name, 'components').catch(() => null)
        if (!cancelled) setComponentsSkillRow(compRow)
      })
      .catch(() => {})

    window.api.skill.getAnatomy(owner, name)
      .then((p: AnatomyPayload | null) => { if (!cancelled) setAnatomyPayload(p) })
      .catch(() => {})

    // Live star check is now folded into the bundle (see fetchRepoBundle
    // above) — bundle.isStarred = repository.viewerHasStarred. We only fall
    // back to the standalone isStarred IPC if the bundle returned null AND
    // the session cache doesn't already have a fresh answer.
    const cachedStar = readSessionCache(_starredCache, cacheKey)
    if (cachedStar !== undefined) setStarred(cachedStar)

    // Storybook detection (non-blocking)
    window.api.storybook.detect(owner, name)
      .then(url => { if (!cancelled) setStorybookState(url) })
      .catch(() => { if (!cancelled) setStorybookState(null) })

    return () => { cancelled = true }
  }, [owner, name])

  // Idle prefetch of the component scan. Fires after the page has settled
  // so the scan result is warm by the time the user clicks the Components
  // tab. Gated on `isComponentLibrary` to avoid running for repos that
  // don't have a Components tab. Uses requestIdleCallback so it competes
  // only for spare CPU — never blocks rendering or interaction. The scan
  // util dedupes if the user clicks the tab while the prefetch is in
  // flight (both will await the same Promise).
  useEffect(() => {
    if (!owner || !name) return
    if (!isComponentLibrary) return
    // Defer until repo.default_branch resolves — otherwise we'd prefetch with
    // the 'main' fallback first, then re-fire with the real branch when repo
    // loads, paying for two scans on repos whose default branch isn't 'main'.
    // In practice isComponentLibrary already gates on repo loading (it reads
    // repo.topics/description), so this guard is defensive belt-and-suspenders.
    const branch = repo?.default_branch
    if (!branch) return
    if (getCachedScan(owner, name, branch)) return

    type IdleHandle = number
    const requestIdle: (cb: () => void, opts?: { timeout: number }) => IdleHandle =
      typeof window.requestIdleCallback === 'function'
        ? (cb, opts) => window.requestIdleCallback(cb, opts) as unknown as IdleHandle
        : (cb) => window.setTimeout(cb, 500) as unknown as IdleHandle
    const cancelIdle: (h: IdleHandle) => void =
      typeof window.cancelIdleCallback === 'function'
        ? (h) => window.cancelIdleCallback(h)
        : (h) => window.clearTimeout(h)

    const handle = requestIdle(() => {
      void performComponentScan(owner, name, branch).catch(() => { /* prefetch swallows errors; tab click will surface them */ })
    }, { timeout: 3000 })

    return () => cancelIdle(handle)
  }, [owner, name, isComponentLibrary, repo?.default_branch])

  // Detect whether this repo contains importable agent content
  // (skills/, agents/, commands/) so the dropdown's "Import to agent library…"
  // menu item only appears for repos where it would actually do something.
  // Deferred via requestIdleCallback so it doesn't compete with critical
  // render. Cached for 5 min per repo. Errors are not cached, so transient
  // failures (offline, rate-limit) get retried on the next visit.
  useEffect(() => {
    if (!owner || !name) return
    setCanImportAgents(false)
    setIsDetectingAgents(true)
    const cacheKey = `${owner}/${name}`
    const cached = readSessionCache(_pluginIndexCache, cacheKey)
    if (cached !== undefined) {
      setCanImportAgents(cached)
      setIsDetectingAgents(false)
      return
    }

    let cancelled = false
    type IdleHandle = number
    const requestIdle: (cb: () => void, opts?: { timeout: number }) => IdleHandle =
      typeof window.requestIdleCallback === 'function'
        ? (cb, opts) => window.requestIdleCallback(cb, opts) as unknown as IdleHandle
        : (cb) => window.setTimeout(cb, 500) as unknown as IdleHandle
    const cancelIdle: (h: IdleHandle) => void =
      typeof window.cancelIdleCallback === 'function'
        ? (h) => window.cancelIdleCallback(h)
        : (h) => window.clearTimeout(h)

    const handle = requestIdle(() => {
      const importApi = window.api.agents?.import
      if (!importApi?.discoverPluginInRepo) {
        setIsDetectingAgents(false)
        return
      }
      importApi.discoverPluginInRepo(`${owner}/${name}`)
        .then(index => {
          if (cancelled) return
          const has = index.skills.length + index.subagents.length + index.slashCommands.length > 0
          setCanImportAgents(has)
          setIsDetectingAgents(false)
          writeSessionCache(_pluginIndexCache, cacheKey, has)
        })
        .catch(() => {
          if (cancelled) return
          setIsDetectingAgents(false)
          /* swallow — button stays hidden, retry on next visit */
        })
    }, { timeout: 3000 })

    return () => { cancelled = true; cancelIdle(handle) }
  }, [owner, name])

  // Releases — deferred fetch. Fires only when the user is on (or navigates
  // to) the Activities tab, since `releases` is no longer used outside of
  // that tab. A session cache (5-min TTL) skips the IPC entirely on
  // same-session revisits. The `releasesFetchedRef` ensures we don't refire
  // on every tab switch within the same repo.
  const releasesFetchedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!owner || !name) return
    if (activeTab !== 'activities') return
    const cacheKey = `${owner}/${name}`
    if (releasesFetchedRef.current === cacheKey) return
    releasesFetchedRef.current = cacheKey

    const cached = readSessionCache(_releasesCache, cacheKey)
    if (cached !== undefined) {
      setReleases(cached)
      return
    }

    let cancelled = false
    window.api.github.getReleases(owner, name)
      .then((r) => {
        if (cancelled) return
        // The IPC handler returns `null` instead of throwing on network error /
        // timeout (avoids spamming the main-process console). `.catch` is still
        // wired up as a backstop in case the handler itself rejects. Clearing
        // the ref on error lets a tab switch back to Activities retry.
        if (r === null) {
          setReleases('error')
          releasesFetchedRef.current = null
        } else {
          setReleases(r)
          writeSessionCache(_releasesCache, cacheKey, r)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReleases('error')
          releasesFetchedRef.current = null
        }
      })
    return () => { cancelled = true }
  }, [owner, name, activeTab])

  // Load collections
  useEffect(() => {
    if (!repo?.id) return
    window.api.library.getCollections(repo.id).then(cols => setRepoCols(cols))
  }, [repo?.id])

  useEffect(() => {
    if (!repo?.id) return
    window.api.engagement.logClick(repo.id, 'detail').catch(() => {})
  }, [repo?.id])

  // Extract YouTube video links, social posts, and commands when README loads
  useEffect(() => {
    if (typeof readme !== 'string' || !readme) return
    setVideoLinks(extractYouTubeLinks(readme))
    setSocialPosts(extractSocialPosts(readme))
    setCommands(extractCommands(readme))
  }, [readme])

  // Secondary Storybook detection: scan README for storybook.io / chromatic.com links
  useEffect(() => {
    if (storybookReadmeScanned) return
    if (storybookState !== null && storybookState !== 'detecting') return // already found
    if (typeof readme !== 'string' || !readme || readme === 'loading') return
    setStorybookReadmeScanned(true)

    const matches = readme.match(/https?:\/\/[^\s)"']+(?:storybook|chromatic)[^\s)"']*/gi)
    if (!matches?.length) return

    const candidates = [...new Set(matches.map(u => {
      try {
        const p = new URL(u)
        return `${p.protocol}//${p.host}`
      } catch { return null }
    }).filter(Boolean))] as string[]

    if (!owner || !name) return
    window.api.storybook.detect(owner, name, candidates)
      .then(url => { if (url) setStorybookState(url) })
      .catch(() => {})
  }, [readme, storybookState, storybookReadmeScanned, owner, name])

  // Safety net: if this repo isn't a component library and the user is somehow on
  // the components tab (e.g. navigated from a component-library repo), redirect to readme.
  useEffect(() => {
    if (!isComponentLibrary && activeTab === 'components') setActiveTab('readme')
  }, [isComponentLibrary, activeTab])

  const handleNavigateToFile = useCallback((path: string) => {
    setFilesTargetPath(path)
    setActiveTab('files')
  }, [])

  // Lazy-fetch oEmbed metadata when the Videos tab is first opened
  useEffect(() => {
    if (activeTab !== 'videos' || videosFetched || videoLinks.length === 0) return
    setVideosFetched(true)
    Promise.all(videoLinks.map(l => fetchYouTubeOEmbed(l)))
      .then(results => setVideoData(results.filter(v => v.thumbnailUrl)))
      .catch(() => {})
  }, [activeTab, videosFetched, videoLinks])

  // Lazy README fetch + translation
  useEffect(() => {
    if (activeTab !== 'readme' || readmeFetched || !owner || !name) return
    setReadmeFetched(true)

    async function loadAndTranslate() {
      const ck = `${owner!}/${name!}`
      let raw: string | null
      try {
        raw = await window.api.github.getReadme(owner!, name!)
      } catch {
        setReadme('error')
        return
      }

      setReadme(raw)
      if (!raw) {
        patchRepoCache(ck, { readme: null, cleanedReadme: '', displayReadme: '', cleanedDisplayReadme: '', readmeBadges: [] })
        return
      }

      // Extract badges from raw content — badges don't translate
      const { badges, cleaned: cleanedRaw } = extractBadges(raw)
      setReadmeBadges(badges)
      setCleanedReadme(cleanedRaw)

      const preferredLang = await window.api.settings.getPreferredLanguage().catch(() => 'en')

      // ── Step 1: Check if repo has a language switcher with a preferred-lang file ──
      const langSwitcher = detectLangSwitcher(raw, owner!, name!)
      const switcherPath = langSwitcher[preferredLang]
        ?? (preferredLang.includes('-') ? langSwitcher[preferredLang.split('-')[0]] : null)

      if (switcherPath) {
        const altContent = await window.api.github.getFileContent(owner!, name!, switcherPath).catch(() => null)
        if (altContent) {
          const { badges: altBadges, cleaned: altCleaned } = extractBadges(altContent)
          setReadmeBadges(altBadges)
          setCleanedReadme(altCleaned)
          setCleanedDisplayReadme(altCleaned)
          setDisplayReadme(altContent)
          setReadme(altContent)
          setReadmeTranslated(true)
          setReadmeDetectedLang('switcher')  // special sentinel — not a detected lang code
          patchRepoCache(ck, { readme: altContent, cleanedReadme: altCleaned, displayReadme: altContent, cleanedDisplayReadme: altCleaned, readmeBadges: altBadges })
          return
        }
      }

      // ── Step 2: Check translation cache ──
      if (repo?.translated_readme && repo.translated_readme_lang === preferredLang) {
        const { cleaned: cleanedCached } = extractBadges(repo.translated_readme)
        setCleanedDisplayReadme(cleanedCached)
        setDisplayReadme(repo.translated_readme)
        setReadmeTranslated(true)
        setReadmeDetectedLang(repo.detected_language ?? null)
        patchRepoCache(ck, { readme: raw, cleanedReadme: cleanedRaw, displayReadme: repo.translated_readme, cleanedDisplayReadme: cleanedCached, readmeBadges: badges })
        return
      }

      // ── Step 3: Machine-translate if needed ──
      const scriptLang = await window.api.translate.check(raw, preferredLang).catch(() => null)
      if (!scriptLang) {
        setCleanedDisplayReadme(cleanedRaw)
        setDisplayReadme(raw)
        patchRepoCache(ck, { readme: raw, cleanedReadme: cleanedRaw, displayReadme: raw, cleanedDisplayReadme: cleanedRaw, readmeBadges: badges })
        return
      }

      // Show original while translating in background
      setCleanedDisplayReadme(cleanedRaw)
      setDisplayReadme(raw)
      setTranslating(true)

      const result = await window.api.translate.translate(raw.slice(0, 8000), preferredLang).catch(() => null)
      setTranslating(false)

      if (!result) {
        patchRepoCache(ck, { readme: raw, cleanedReadme: cleanedRaw, displayReadme: raw, cleanedDisplayReadme: cleanedRaw, readmeBadges: badges })
        return
      }

      const { cleaned: cleanedTranslated } = extractBadges(result.translatedText)
      setCleanedDisplayReadme(cleanedTranslated)
      setDisplayReadme(result.translatedText)
      setReadmeTranslated(true)
      setReadmeDetectedLang(scriptLang)
      patchRepoCache(ck, { readme: raw, cleanedReadme: cleanedRaw, displayReadme: result.translatedText, cleanedDisplayReadme: cleanedTranslated, readmeBadges: badges })

      // Cache result
      if (repo?.id) {
        window.api.db.cacheTranslatedReadme(
          repo.id,
          result.translatedText,
          preferredLang,
          scriptLang,
        ).catch(() => {})
      }
    }

    loadAndTranslate()
  }, [activeTab, readmeFetched, owner, name]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────
  const handleFork = () => {
    if (!owner || !name) return
    void window.api.openExternal(`https://github.com/${owner}/${name}/fork`)
    void window.api.github.recordFork(owner, name)
  }

  const handleArchive = () => {
    if (!owner || !name) return
    archiveToggle(owner, name)
  }

  const handleStar = async () => {
    if (starWorking || !owner || !name) return
    setStarWorking(true)
    const cacheKey = `${owner}/${name}`
    try {
      if (starred) {
        await window.api.github.unstarRepo(owner, name)
        setStarred(false)
        writeSessionCache(_starredCache, cacheKey, false)
      } else {
        await window.api.github.starRepo(owner, name)
        setStarred(true)
        writeSessionCache(_starredCache, cacheKey, true)
        window.api.svgCache.prefetch(owner, name, repo?.default_branch ?? 'main').catch(() => {})
      }
      window.dispatchEvent(new CustomEvent('library:changed'))
    } catch { /* silently ignore */ }
    finally { setStarWorking(false) }
  }

  const handleLearn = async () => {
    if (learnState !== 'UNLEARNED') return
    setLearnState('LEARNING')
    setLearnError(null)
    try {
      await saveRepo(owner ?? '', name ?? '')
      const result = await startLearn(owner ?? '', name ?? '', () =>
        window.api.skill.generate(owner ?? '', name ?? '', { flavour }),
      )
      if (result && 'cancelled' in result) {
        setLearnState('UNLEARNED')
        return
      }
      const freshRow = await window.api.skill.get(owner ?? '', name ?? '')
      setSkillRow(freshRow)
      const freshComp = await window.api.skill.getSubSkill(owner ?? '', name ?? '', 'components').catch(() => null)
      setComponentsSkillRow(freshComp)
      setLearnState('LEARNED')
      window.dispatchEvent(new CustomEvent('library:changed'))
      window.api.svgCache.prefetch(owner ?? '', name ?? '', repo?.default_branch ?? 'main').catch(() => {})
    } catch (err) {
      setLearnState('UNLEARNED')
      const msg = err instanceof Error ? err.message : ''
      setLearnError(msg.includes('Claude Code not found') || msg.includes('No API key') ? 'no-key' : 'failed')
    }
  }

  const handleRelearnTarget = async (target: 'master' | 'components'): Promise<boolean> => {
    setRelearningTarget(target)
    setLearnError(null)
    try {
      const result = await startLearn(owner ?? '', name ?? '', () =>
        window.api.skill.generate(owner ?? '', name ?? '', { flavour, target }),
      )
      if (result && 'cancelled' in result) return false
      if (target === 'master') {
        const freshRow = await window.api.skill.get(owner ?? '', name ?? '')
        setSkillRow(freshRow)
      }
      if (target === 'components') {
        const freshComp = await window.api.skill.getSubSkill(owner ?? '', name ?? '', 'components').catch(() => null)
        setComponentsSkillRow(freshComp)
      }
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setLearnError(msg.includes('Claude Code not found') || msg.includes('No API key') ? 'no-key' : 'failed')
      return false
    } finally {
      setRelearningTarget(null)
    }
  }

  const handleRelearnAll = async () => {
    setLearnError(null)
    const masterOk = await handleRelearnTarget('master')
    if (!masterOk) return
    if (componentsSkillRow) {
      await handleRelearnTarget('components')
    }
  }

  const handleUnlearn = async () => {
    if (!owner || !name) return
    await window.api.skill.delete(owner, name)
    setSkillRow(null)
    setComponentsSkillRow(null)
    setLearnState('UNLEARNED')
    window.dispatchEvent(new CustomEvent('library:changed'))
  }


  async function handleVersionLearn(tag: string) {
    setVersionLearnStates(prev => new Map(prev).set(tag, 'LEARNING'))
    try {
      await window.api.github.saveRepo(owner ?? '', name ?? '')
      await window.api.skill.generate(owner ?? '', name ?? '', { flavour: 'library', ref: tag })
      setVersionedLearns(prev => new Set([...prev, tag]))
      setVersionLearnStates(prev => { const m = new Map(prev); m.delete(tag); return m })
    } catch {
      setVersionLearnStates(prev => new Map(prev).set(tag, 'ERROR'))
    }
  }

  // ── Derived values ────────────────────────────────────────────────
  const topics = parseTopics(repo?.topics ?? null)
  const cfg = getLangConfig(repo?.language ?? '')
  const typeBucket = repo?.type_bucket ?? (repo ? classifyRepoBucket(repo)?.bucket : null) ?? null
  const typeConfig = getSubTypeConfig(repo?.type_sub ?? null)
  const ditherGradient = getBucketGradient(typeConfig?.accentColor ?? getBucketColor(typeBucket))

  // Badge category buckets
  // YouTube video/playlist links are excluded from Community — they live in the Videos tab
  const isYouTubeVideoLink = (url: string | null) => {
    if (!url) return false
    const u = url.toLowerCase()
    return u.includes('youtube.com/watch') ||
           u.includes('youtu.be/') ||
           u.includes('youtube.com/playlist') ||
           u.includes('youtube.com/shorts') ||
           u.includes('youtube.com/embed')
  }
  const packageBadges = readmeBadges.filter(b => b.category === 'package')
  const qualityBadges = readmeBadges.filter(b => b.category === 'quality')
  const socialBadges  = readmeBadges.filter(b =>
    b.category === 'social' &&
    !isYouTubeVideoLink(b.linkUrl)
  )
  const miscBadges    = readmeBadges.filter(b => b.category === 'badge')

  const visibleTabs = ALL_TABS.filter(t =>
    // 'activities' is always visible — the empty-state placeholder handles
    // repos with no releases. README is still the default landing tab when
    // releases resolves empty/error (fellBackRef effect demotes activeTab).
    (t.id !== 'related'    || related.length > 0) &&
    (t.id !== 'videos'     || videoLinks.length > 0) &&
    (t.id !== 'posts'      || socialPosts.length > 0) &&
    (t.id !== 'commands'   || commands.length > 0) &&
    (t.id !== 'components' || isComponentLibrary)
  )

  const skillDepths = skillRow ? parseSkillDepths(skillRow.content) : null

  const liveTier    = (repo ? verification.getTier(repo.id) : null) ?? seedTier
  const liveSignals = (repo && verification.getSignals(repo.id).length > 0)
    ? verification.getSignals(repo.id)
    : seedSignals

  // Defer heavy README rendering so the page header/tabs render first
  const isReadmeLoaded = readme !== 'loading' && readme !== 'error' && readme !== null
  const rawReadmeContent = isReadmeLoaded
    ? ((showOriginal || !readmeTranslated)
        ? (cleanedReadme || (readme as string))
        : (cleanedDisplayReadme || displayReadme))
    : ''
  const deferredReadmeContent = useDeferredValue(rawReadmeContent)

  // ── Article slot content ─────────────────────────────────────────
  const bylineNode = (
    <>
      {repo?.avatar_url ? (
        <img
          src={repo.avatar_url}
          alt={owner ?? 'owner'}
          className="article-layout-byline-avatar"
        />
      ) : (
        <div
          className="article-layout-byline-avatar-fallback"
          style={{ background: `${cfg.primary}33`, color: cfg.primary }}
        >
          {cfg.abbr}
        </div>
      )}
      <button
        className="article-layout-byline-name owner-name-btn"
        onClick={(e) => { e.stopPropagation(); openProfile(owner ?? '') }}
      >
        {owner}
      </button>
      {repo && (
        <span className="article-layout-byline-meta">
          <span className="article-layout-byline-meta-sep">·</span>
          Updated {formatDate(repo.pushed_at ?? repo.updated_at)}
        </span>
      )}
    </>
  )

  const titleNode = (
    <>
      <span>{name}</span>
      <VerificationBadge tier={liveTier} signals={liveSignals} size="md" variant="icon" />
      {owner && name && (
        <a
          href={`https://github.com/${owner}/${name}`}
          onClick={e => { e.preventDefault(); window.api.openExternal(`https://github.com/${owner}/${name}`) }}
          title="View on GitHub"
          style={{ display: 'flex', alignItems: 'center', color: 'var(--t3)', flexShrink: 0, lineHeight: 0 }}
          className="repo-title-github-link"
        >
          <svg viewBox="0 0 16 16" width={18} height={18} fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>
      )}
    </>
  )

  const titleExtrasNode = (repo?.language && repo.language !== '—') || typeConfig ? (
    <>
      {repo?.language && repo.language !== '—' && (
        <span className="repo-detail-header-pill" style={{ '--pill-color': getLangColor(repo.language) } as React.CSSProperties}>
          <LanguageIcon lang={repo.language} size={24} boxed />
          <span className="repo-detail-header-pill-label">{repo.language}</span>
        </span>
      )}
      {typeConfig && (() => {
        const CatIcon = typeConfig.icon
        return (
          <span className="repo-detail-header-pill" style={{ '--pill-color': typeConfig.accentColor } as React.CSSProperties}>
            <span className="repo-detail-header-pill-cat-icon" style={{ background: typeConfig.accentColor }}>
              {CatIcon && <CatIcon size={14} fill="#fff" stroke="#fff" />}
            </span>
            <span className="repo-detail-header-pill-label">{typeConfig.label}</span>
          </span>
        )
      })()}
    </>
  ) : null

  const tabsNode = (
    <div className="repo-detail-tabs">
      {visibleTabs.map(t => (
        <button
          key={t.id}
          className={`repo-detail-tab${activeTab === t.id ? ' active' : ''}${t.id === 'components' && storybookState === 'detecting' && activeTab !== 'components' ? ' repo-detail-tab--loading' : ''}`}
          onClick={() => setActiveTab(t.id)}
        >
          {t.id === 'videos'   ? `Videos (${videoLinks.length})`
           : t.id === 'posts'    ? `Posts (${socialPosts.length})`
           : t.id === 'commands' ? `Commands (${commands.length})`
           : t.label}
        </button>
      ))}
    </div>
  )

  const isFullBleedTab = activeTab === 'components' || activeTab === 'files'

  // While stats is loading, show ONLY the layout-mirroring skeleton — the user
  // explicitly asked for a unified loading state ("just appearing all in the
  // one") rather than the previous behavior of partial real tiles (Repository,
  // Topics, Notes) appearing alongside a small stats placeholder. Once stats
  // resolve, the right panel renders the full sidebar atomically.
  const isStatsLoading = repoStats === 'loading'
  const statsSlotNode = !repoError ? (
    isStatsLoading ? (
      <div className="stats-sidebar">
        <RepoStatsSidebar stats={repoStats} />
      </div>
    ) : (
    <div className="stats-sidebar">

      {repo && (
        <RepoNotes repoId={repo.id} owner={owner!} repoName={name!} />
      )}

      {/* ── Enriched stats sidebar ── */}
      <RepoStatsSidebar stats={repoStats} owner={owner} name={name} />

      {/* ── Skills Folder tile (only when learned) ── */}
      {learnState === 'LEARNED' && skillRow && (
        <div className="stats-tile">
          <SidebarLabel>Skills Folder</SidebarLabel>
          <div
            className="skill-hover-group"
            onMouseEnter={() => setHoveredBox('master')}
            onMouseLeave={() => setHoveredBox(null)}
          >
            <div className="sidebar-skill-panel">
              <div className="sidebar-skill-panel-header">
                <span className="sidebar-skill-panel-filename">{name}.skill.md</span>
                <span className="sidebar-skill-panel-badge">✓ active</span>
              </div>
              <div className="sidebar-skill-panel-body">
                {skillDepths && (() => {
                  const total = Math.max(skillDepths.core + skillDepths.extended + skillDepths.deep, 1)
                  return [
                    { label: 'Core',     lines: skillDepths.core,     color: '#059669', pct: Math.round(skillDepths.core / total * 100) },
                    { label: 'Extended', lines: skillDepths.extended, color: '#6d28d9', pct: Math.round((skillDepths.core + skillDepths.extended) / total * 100) },
                    { label: 'Deep',     lines: skillDepths.deep,     color: '#4c1d95', pct: 100 },
                  ].map(({ label, lines, color, pct }) => (
                    <div key={label} className="sidebar-skill-depth-row">
                      <span className="sidebar-skill-depth-label">{label}</span>
                      <div className="sidebar-skill-depth-track">
                        <div className="sidebar-skill-depth-fill" style={{ width: `${pct}%`, background: color }} />
                      </div>
                      <span className="sidebar-skill-depth-count">~{lines}</span>
                    </div>
                  ))
                })()}
                <div className="sidebar-skill-panel-meta">
                  {skillRow.version ? `${skillRow.version} · ` : ''}{daysAgoLabel(skillRow.generated_at)}
                </div>
              </div>
            </div>
            <div className={`skill-hover-drawer${(hoveredBox === 'master' || relearningTarget === 'master') ? ' skill-hover-drawer--visible' : ''}`}>
              <button className="btn-drawer-regen" aria-label="Relearn master skill" onClick={() => handleRelearnTarget('master')} disabled={relearningTarget !== null}>
                {relearningTarget === 'master' ? <><span className="spin-ring" style={{ width: 8, height: 8 }} /> Relearning…</> : '↺ Relearn'}
              </button>
            </div>
          </div>
          {componentsSkillRow && (
            <div
              className="skill-hover-group"
              onMouseEnter={() => setHoveredBox('components')}
              onMouseLeave={() => setHoveredBox(null)}
              style={{ marginTop: 4 }}
            >
              <div className="sidebar-sub-skill-box">
                <div className="sidebar-sub-skill-header">
                  <span className="sidebar-sub-skill-dot" style={{ background: '#6366f1' }} />
                  <span className="sidebar-sub-skill-filename">{componentsSkillRow.filename}</span>
                </div>
                <div className="sidebar-sub-skill-meta">
                  {(new Blob([componentsSkillRow.content]).size / 1024).toFixed(1)} KB
                  {componentsSkillRow.generated_at ? ` · ${daysAgoLabel(componentsSkillRow.generated_at)}` : ''}
                </div>
              </div>
              <div className={`skill-hover-drawer${(hoveredBox === 'components' || relearningTarget === 'components') ? ' skill-hover-drawer--visible' : ''}`}>
                <button className="btn-drawer-regen" aria-label="Relearn components skill" onClick={() => handleRelearnTarget('components')} disabled={relearningTarget !== null}>
                  {relearningTarget === 'components' ? <><span className="spin-ring" style={{ width: 8, height: 8 }} /> Relearning…</> : '↺ Relearn'}
                </button>
              </div>
            </div>
          )}
          <div className="skills-folder-actions">
            <button className="btn-skills-folder-action" onClick={handleRelearnAll} disabled={relearningTarget !== null}>
              {relearningTarget !== null ? <><span className="spin-ring" style={{ width: 8, height: 8 }} /> Relearning…</> : '↺ Relearn all'}
            </button>
          </div>
        </div>
      )}

      {/* ── Repository tile ── */}
      {repo && (
        <div className="stats-tile">
          <SidebarLabel>Repository</SidebarLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {([
              { key: 'License',        val: formatLicense(repo.license) ?? '—' },
              { key: 'Size',           val: formatSize(repo.size) },
              { key: 'Watchers',       val: formatCount(repo.watchers) },
              { key: 'Default branch', val: repo.default_branch ?? 'main', isMono: true },
            ] as { key: string; val: string; isMono?: boolean }[]).map(({ key, val, isMono }) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                <span style={{ fontFamily: 'Inter, sans-serif', color: 'var(--t3)' }}>{key}</span>
                <span style={{ fontFamily: isMono ? 'JetBrains Mono, monospace' : 'Inter, sans-serif', color: 'var(--t2)', fontWeight: 500 }}>
                  {val}
                </span>
              </div>
            ))}
          </div>

        </div>
      )}

      {/* ── Badge tiles (conditional, populated after README loads) ── */}
      {packageBadges.length > 0 && (
        <div className="stats-tile">
          <SidebarLabel>Packages</SidebarLabel>
          <div className="sidebar-badge-row">
            {packageBadges.map((b, i) => <BadgePill key={i} badge={b} />)}
          </div>
        </div>
      )}

      {qualityBadges.length > 0 && (
        <div className="stats-tile">
          <SidebarLabel>Quality</SidebarLabel>
          <div className="sidebar-badge-row">
            {qualityBadges.map((b, i) => <BadgePill key={i} badge={b} />)}
          </div>
        </div>
      )}

      {socialBadges.length > 0 && (
        <div className="stats-tile">
          <SidebarLabel>Community</SidebarLabel>
          <div className="sidebar-social-row">
            {socialBadges.map((b, i) => <SocialIcon key={i} badge={b} />)}
          </div>
        </div>
      )}

      {miscBadges.length > 0 && (
        <div className="stats-tile">
          <SidebarLabel>Badges</SidebarLabel>
          <div className="sidebar-badge-row">
            {miscBadges.map((b, i) => <BadgePill key={i} badge={b} />)}
          </div>
        </div>
      )}

      {/* ── Topics tile ── */}
      {topics.length > 0 && (
        <div className="stats-tile">
          <SidebarLabel>Topics</SidebarLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {topics.map(tag => (
              <button
                key={tag}
                className="repo-card-tag"
                onClick={() => navigate('/discover', { state: { preloadTag: tag } })}
                style={{ fontSize: 10, padding: '2px 8px' }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}


    </div>
    )
  ) : null

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="repo-detail">
      {/* Stage — chiaroscuro background + glass panel */}
      <div className="repo-detail-stage">
        {/* Learn error banner */}
        {learnError && (
          <div className="repo-detail-install-error">
            {learnError === 'no-key'
              ? <>To generate skills, add an Anthropic API key in{' '}
                  <button className="install-error-link" onClick={() => navigate('/settings')}>Settings</button>
                  {' '}or run <code style={{ fontSize: 10, background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3 }}>npm i -g @anthropic-ai/claude-code</code> then restart.
                </>
              : 'Learning failed — try again'}
          </div>
        )}

        {/* Glass panel */}
        <div className="repo-detail-layout" data-fullbleed-tab={isFullBleedTab ? '' : undefined}>
          <div className="repo-detail-panel">
        {repoError ? (
          <div style={{ padding: 20, fontSize: 11, color: 'var(--t2)', flex: 1 }}>
            Could not load repo — check your connection.
          </div>
        ) : (
          // Render the layout immediately — banner nodes (titleNode, bylineNode,
          // titleExtrasNode, etc.) are null-safe and use URL-derived owner/name
          // until `repo` resolves. Each tab manages its own loading placeholder
          // so the user sees the page chrome from the first paint.
          <div className="repo-detail-content-fadein">
          <ArticleLayout
            navBar={inLibrary ? null : <NavBar />}
            byline={bylineNode}
            dither={<DitherBackground avatarUrl={repo?.avatar_url} fallbackGradient={ditherGradient} staticFrame staticCameraIdx={cameraIdxForRepo(owner ?? '', name ?? '')} />}
            title={titleNode}
            titleExtras={titleExtrasNode}
            description={
              repo?.description
                ? <>{repo.description}</>
                : repo === null && !repoError
                  ? <span className="skeleton-shimmer repo-detail-skeleton-description" aria-hidden="true" />
                  : undefined
            }
            tabs={tabsNode}
            scrollRef={articleBodyRef}
            tocSlot={
              activeTab === 'readme' && tocHeadings.length >= 2
                ? <TocNav
                    headings={tocHeadings}
                    scrollContainerRef={articleBodyRef}
                    headingsContainerRef={readmeBodyRef}
                  />
                : undefined
            }
            statsSlot={activeTab === 'activities' ? statsSlotNode : undefined}
            body={
              <>
                {activeTab === 'readme' && (
                  readme === 'loading' || (deferredReadmeContent === '' && rawReadmeContent !== '') ? (
                    <div className="repo-detail-skeleton-readme" aria-hidden="true">
                      <span className="skeleton-shimmer" style={{ width: '92%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '88%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '76%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '94%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '70%', height: 14 }} />
                      <span className="skeleton-shimmer" style={{ width: '82%', height: 14 }} />
                    </div>
                  ) : readme === 'error' ? (
                    <p className="repo-detail-placeholder">Failed to load README.</p>
                  ) : readme === null ? (
                    <p className="repo-detail-placeholder">No README available.</p>
                  ) : (
                    <Suspense fallback={<div style={{ minHeight: 200 }} />}>
                      <ReadmeRenderer
                        content={deferredReadmeContent || (readme as string)}
                        repoOwner={owner ?? ''}
                        repoName={name ?? ''}
                        branch={repo?.default_branch ?? 'main'}
                        onNavigateToFile={handleNavigateToFile}
                        onTocReady={handleTocReady}
                        readmeBodyRef={readmeBodyRef}
                        invertDarkImages={invertDarkImages}
                      />
                    </Suspense>
                  )
                )}

                {activeTab === 'files' && repo && (
                  <FilesTab
                    owner={owner ?? ''}
                    name={name ?? ''}
                    branch={repo.default_branch ?? 'main'}
                    initialPath={filesTargetPath}
                  />
                )}

                {activeTab === 'skill' && (
                  skillRow ? (
                    skillRow.anatomy_source && anatomyPayload ? (
                      <div className="anatomy-skill-tab">
                        <AnatomyIndicators payload={anatomyPayload} updateAvailable={(repo?.update_available ?? 0) as number} />
                        <AnatomyView payload={anatomyPayload} />
                        <AnatomyMemoryPanel entries={anatomyPayload.memory} />
                      </div>
                    ) : (
                    <>
                      {(() => {
                        const skillFiles = [
                          { key: 'master', filename: skillRow.filename, content: skillRow.content, version: skillRow.version, generated_at: skillRow.generated_at, color: '#059669' },
                          ...(componentsSkillRow ? [{ key: 'components', filename: componentsSkillRow.filename, content: componentsSkillRow.content, version: componentsSkillRow.version, generated_at: componentsSkillRow.generated_at, color: '#6366f1' }] : []),
                        ]
                        const selected = skillFiles.find(f => f.key === selectedSkillFile) ?? skillFiles[0]
                        return (
                          <>
                            <div className="skill-file-picker">
                              {skillFiles.map(f => (
                                <button
                                  key={f.key}
                                  className={`skill-file-card${selectedSkillFile === f.key ? ' active' : ''}`}
                                  style={{ '--card-color': f.color } as React.CSSProperties}
                                  onClick={() => setSelectedSkillFile(f.key)}
                                >
                                  <svg width="20" height="20" viewBox="0 0 16 16" fill={f.color}>
                                    <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8.75 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688Z"/>
                                  </svg>
                                  <span className="skill-file-card-name">{f.filename}</span>
                                </button>
                              ))}
                            </div>
                            <div className="skill-tab-header">
                              <div className="skill-tab-file-info">
                                <span>
                                  <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5 }}>
                                    <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm.25-11.25a.75.75 0 0 0-1.5 0v4.69L5.03 7.72a.75.75 0 0 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.06 0l2.5-2.5a.75.75 0 0 0-1.06-1.06L8.25 9.44V4.75Z"/>
                                  </svg>
                                  {(new Blob([selected.content]).size / 1024).toFixed(1)} KB
                                </span>
                                {(selected.version ?? '') !== '' && (
                                  <span>{selected.version}</span>
                                )}
                                {selected.generated_at && (
                                  <span>
                                    <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5 }}>
                                      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z"/>
                                    </svg>
                                    {daysAgoLabel(selected.generated_at)}
                                  </span>
                                )}
                              </div>
                              {selected.key === 'master' && skillDepths && [
                                { label: 'Core',     lines: skillDepths.core,     pct: Math.round((skillDepths.core / Math.max(skillDepths.core + skillDepths.extended + skillDepths.deep, 1)) * 100),                                                                                          color: '#059669' },
                                { label: 'Extended', lines: skillDepths.extended, pct: Math.round(((skillDepths.core + skillDepths.extended) / Math.max(skillDepths.core + skillDepths.extended + skillDepths.deep, 1)) * 100), color: '#6d28d9' },
                                { label: 'Deep',     lines: skillDepths.deep,     pct: 100,                                                                                                                                      color: '#4c1d95' },
                              ].map(d => (
                                <div key={d.label} className="skill-tab-depth-row">
                                  <span className="skill-tab-depth-label">{d.label}</span>
                                  <div className="skill-tab-depth-track">
                                    <div className="skill-tab-depth-fill" style={{ width: `${d.pct}%`, background: d.color }} />
                                  </div>
                                  <span className="skill-tab-depth-meta">~{d.lines} lines</span>
                                </div>
                              ))}
                              {selected.key === 'master' && <p className="skill-tab-note">Models read as far as context allows.</p>}
                            </div>
                            <SkillFileContent content={selected.content} />
                          </>
                        )
                      })()}
                    </>
                    )
                  ) : (
                    <p className="repo-detail-placeholder">Learn this repo to generate a Skills Folder for Claude.</p>
                  )
                )}

                {activeTab === 'activities' && (() => {
                  const stillLoading = releases === 'loading' || userEvents === 'loading'
                  const releasesFailed = releases === 'error'
                  const userEventsFailed = userEvents === 'error'
                  const bothFailed = releasesFailed && userEventsFailed
                  // Releases is the GitHub network call and fails far more often than
                  // userEvents (a local SQLite read). Without this branch, a releases
                  // failure silently falls through to the render path below — and since
                  // every repo in the local DB has a "created" event in userEvents, the
                  // user would see ONLY that lone "created" row with no indication that
                  // releases failed (the original "second fetch wiped my activities" bug).
                  const releasesOnlyFailed = releasesFailed && !userEventsFailed
                  if (stillLoading) {
                    return <p className="repo-detail-placeholder">Loading activity…</p>
                  }
                  if (bothFailed || (releasesFailed && repoActivityItems.length === 0)) {
                    return <p className="repo-detail-placeholder">Failed to load activity.</p>
                  }
                  if (repoActivityItems.length === 0) {
                    return <p className="repo-detail-placeholder">No activity yet.</p>
                  }
                  return (
                    <div className="repo-activity-split">
                      <div className="repo-activity-split-left">
                        {releasesOnlyFailed && (
                          <p className="repo-activity-partial-error">
                            Couldn't load releases — showing local events only.
                          </p>
                        )}
                        {featuredActivityItem && bannerPropsByEventId.get(featuredActivityItem.event.id) && (
                          <div className="repo-activity-featured">
                            <div className="repo-activity-featured__header">
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                                <polygon points="5,0.5 6.5,3.5 9.5,4 7.25,6.25 7.75,9.5 5,8 2.25,9.5 2.75,6.25 0.5,4 3.5,3.5" />
                              </svg>
                              Featured
                            </div>
                            <BannerCard {...bannerPropsByEventId.get(featuredActivityItem.event.id)!} />
                          </div>
                        )}
                        {displayedActivityGroups.map(group => {
                          return (
                            <div key={group.label} className="repo-activity-group">
                              <DateDivider label={group.label} />
                              {group.items.map(item => (
                                item.kind === 'release' ? (
                                  <BannerCard
                                    key={item.event.id}
                                    {...bannerPropsByEventId.get(item.event.id)!}
                                  />
                                ) : (
                                  <RepoUserEventRow
                                    key={`${item.event.type}-${item.ts}`}
                                    event={item.event}
                                    repoOwner={owner!}
                                    repoName={name!}
                                    userLogin={userLogin}
                                    userAvatarUrl={userAvatarUrl}
                                  />
                                )
                              ))}
                            </div>
                          )
                        })}
                      </div>
                      <div className="repo-activity-split-right" />
                    </div>
                  )
                })()}

                {activeTab === 'collections' && (
                  <div style={{ padding: '4px 0' }}>
                    {repoCols.length === 0 ? (
                      <p className="repo-detail-placeholder">
                        Not in any collections. Add to a collection from the Collections view.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {repoCols.map(col => (
                          <button
                            key={col.id}
                            onClick={() => navigate(`/collections?select=${col.id}`)}
                            style={{
                              background: 'var(--accent-soft)', border: '1px solid var(--accent-border)',
                              borderRadius: 20, padding: '4px 12px', fontSize: 11,
                              color: 'var(--accent-text)', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                            }}
                          >
                            {col.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'related' && (
                  <div className="related-repos-grid">
                    {related.map(r => (
                      <div
                        key={`${r.owner}/${r.name}`}
                        className="related-repo-card"
                        onClick={() => navigate(`/repo/${r.owner}/${r.name}`)}
                      >
                        <span className="related-repo-name">{r.name}</span>
                        {r.description && <p className="related-repo-desc">{r.description}</p>}
                        <span className="related-repo-stars">★ {formatStars(r.stars)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'videos' && (
                  videoData.length === 0 && videosFetched ? (
                    <p className="repo-detail-placeholder">No playable videos found.</p>
                  ) : videoData.length === 0 ? (
                    <p className="repo-detail-placeholder">Loading videos…</p>
                  ) : (
                    <>
                      <div className="video-grid">
                        {videoData.map((v, i) => (
                          <div
                            key={i}
                            className="video-card"
                            onClick={() => window.api.openExternal(v.url)}
                          >
                            <div className="video-thumbnail-wrap">
                              <img
                                src={v.thumbnailUrl}
                                alt={v.title}
                                className="video-thumbnail"
                                onError={e => {
                                  const el = e.target as HTMLImageElement
                                  el.style.display = 'none'
                                  el.parentElement!.classList.add('video-thumbnail-missing')
                                }}
                              />
                              {/* Play button overlay */}
                              <div className="video-play-overlay" aria-hidden>
                                <div className="video-play-btn">
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                                    <path d="M8 5v14l11-7z"/>
                                  </svg>
                                </div>
                              </div>
                              {/* YouTube logo badge */}
                              <div className="video-yt-badge">
                                <svg width="14" height="10" viewBox="0 0 90 63" fill="#FF0000">
                                  <path d="M88.1 9.8C87 5.9 84 2.8 80.2 1.7 73.2 0 45 0 45 0S16.8 0 9.8 1.7C6 2.8 3 5.9 1.9 9.8 0 16.9 0 31.5 0 31.5s0 14.6 1.9 21.7c1.1 3.9 4.1 7 7.9 8.1C16.8 63 45 63 45 63s28.2 0 35.2-1.7c3.8-1.1 6.8-4.2 7.9-8.1C90 46.1 90 31.5 90 31.5s0-14.6-1.9-21.7z"/>
                                  <path d="M36 45l23.3-13.5L36 18v27z" fill="white"/>
                                </svg>
                              </div>
                            </div>
                            <div className="video-info">
                              <div className="video-title">
                                {v.title || 'YouTube Video'}
                              </div>
                              {v.author && (
                                <div className="video-author">{v.author}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {videoLinks.length > videoData.length && (
                        <p style={{
                          fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--t3)',
                          marginTop: 12, textAlign: 'center',
                        }}>
                          Showing {videoData.length} of {videoLinks.length} videos
                        </p>
                      )}
                    </>
                  )
                )}

                {activeTab === 'posts' && (
                  <div className="post-grid">
                    {socialPosts.map((p, i) => {
                      const platformColors: Record<string, string> = {
                        twitter:  '#000000',
                        facebook: '#1877F2',
                        linkedin: '#0A66C2',
                      }
                      const platformLabels: Record<string, string> = {
                        twitter:  'X / Twitter',
                        facebook: 'Facebook',
                        linkedin: 'LinkedIn',
                      }
                      const color = platformColors[p.platform] ?? 'var(--t3)'
                      const PlatformIcon = p.platform === 'twitter'
                        ? XTwitterIcon
                        : p.platform === 'facebook'
                          ? SiFacebook
                          : LinkedInIcon
                      return (
                        <div
                          key={i}
                          className="post-card"
                          onClick={() => window.api.openExternal(p.url)}
                          title={p.url}
                        >
                          <div className="post-card-header">
                            <div className="post-card-icon" style={{ background: `${color}18`, color }}>
                              <PlatformIcon size={14} />
                            </div>
                            <div>
                              <div className="post-card-platform-name" style={{ color }}>
                                {platformLabels[p.platform]}
                              </div>
                              <div className="post-card-type">{p.postType}</div>
                            </div>
                          </div>
                          {p.handle && (
                            <div className="post-card-handle">{p.handle}</div>
                          )}
                          <div className="post-card-url">
                            {p.url.replace(/^https?:\/\/(www\.)?/, '')}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {activeTab === 'commands' && (
                  <div className="cmd-list">
                    {commands.map((blk, i) => (
                      <CommandBlockCard key={i} block={blk} />
                    ))}
                  </div>
                )}

                {activeTab === 'components' && isComponentLibrary && (
                  storybookState === 'detecting' ? (
                    <div className="sb-detecting">
                      <span>Detecting…</span>
                    </div>
                  ) : typeof storybookState === 'string' ? (
                    <Suspense fallback={null}>
                      <StorybookExplorer
                        storybookUrl={storybookState}
                        repoName={name ?? ''}
                      />
                    </Suspense>
                  ) : (
                    <Suspense fallback={null}>
                      <ComponentExplorer
                        key={`${owner ?? ''}/${name ?? ''}`}
                        owner={owner ?? ''}
                        name={name ?? ''}
                        branch={repo?.default_branch ?? 'main'}
                      />
                    </Suspense>
                  )
                )}
              </>
            }
            actionRow={
              <RepoArticleActionRow
                learnState={learnState}
                learnProgress={learnProgress}
                starred={starred}
                starWorking={starWorking}
                starCount={repo?.stars ?? 0}
                cloneOpen={cloneOpen}
                onToggleClone={() => setCloneOpen(v => !v)}
                onLearn={handleLearn}
                onUnlearn={handleUnlearn}
                onStar={handleStar}
                onFork={handleFork}
                archived={archived}
                onArchive={handleArchive}
                canImportAgents={canImportAgents}
                isDetectingAgents={isDetectingAgents}
                onImportToAgentLibrary={() => setImportAgentOpen(true)}
                translationStatus={activeTab === 'readme' ? {
                  translating,
                  translated: readmeTranslated,
                  detectedLang: readmeDetectedLang,
                  showOriginal,
                  onToggleOriginal: () => setShowOriginal(prev => !prev),
                } : null}
              />
            }
            actionRowExtras={
              repo && (
                <CloneOptionsPanel
                  open={cloneOpen}
                  owner={owner ?? ''}
                  name={name ?? ''}
                  typeBucket={typeBucket ?? ''}
                  typeSub={repo?.type_sub ?? null}
                  defaultBranch={repo?.default_branch ?? 'main'}
                />
              )
            }
            fullBleedBody={isFullBleedTab}
            collapsedHeader={activeTab === 'files' || activeTab === 'components'}
          />
          </div>
        )}
          </div>
        </div>
      </div>
      {selectedReleaseId && (
        <ActivityModal
          events={activityEvents}
          initialEventId={selectedReleaseId}
          onClose={() => setSelectedReleaseId(null)}
          onLearnVersion={handleVersionLearn}
          versionLearnStates={versionLearnStates}
          versionedLearns={versionedLearns}
        />
      )}
      <ImportPluginDialog
        open={importAgentOpen}
        onClose={() => setImportAgentOpen(false)}
        initialRepoUrl={owner && name ? `${owner}/${name}` : undefined}
      />
    </div>
  )
}

// -- Article action row --
type RepoArticleActionRowProps = {
  learnState: 'UNLEARNED' | 'LEARNING' | 'LEARNED'
  learnProgress: ReturnType<typeof useLearningProgress>
  starred: boolean
  starWorking: boolean
  starCount: number
  cloneOpen: boolean
  onToggleClone: () => void
  onLearn: () => void
  onUnlearn: () => void
  onStar: () => void
  onFork: () => void
  archived: boolean
  onArchive: () => void
  canImportAgents: boolean
  isDetectingAgents: boolean
  onImportToAgentLibrary: () => void
  /** Translation status — rendered on the right when on the readme tab and translation is active */
  translationStatus?: {
    translating: boolean
    translated: boolean
    detectedLang: string | null
    showOriginal: boolean
    onToggleOriginal: () => void
  } | null
}

function RepoArticleActionRow({
  learnState, learnProgress, starred, starWorking,
  cloneOpen, onToggleClone,
  onLearn, onUnlearn, onStar, onFork,
  archived, onArchive,
  canImportAgents, isDetectingAgents, onImportToAgentLibrary,
  translationStatus,
}: RepoArticleActionRowProps) {
  const variant: 'primary' | 'idle' | 'learned' =
    learnState === 'UNLEARNED' ? 'idle' :
    learnState === 'LEARNED'   ? 'learned' :
                                 'primary'
  const actionLabel =
    learnState === 'UNLEARNED' ? 'Learn' :
    learnState === 'LEARNING'  ? 'Cancel' :
                                 'Learned'
  const onAction =
    learnState === 'UNLEARNED' ? onLearn :
    learnState === 'LEARNING'  ? () => { void learnProgress.cancel() } :
                                 onUnlearn
  const actionIcon =
    learnState === 'UNLEARNED' ? <PiBrainFill size={20} /> :
    learnState === 'LEARNING'  ? <span className="split-button-cancel-icon"><span /><span /></span> :
                                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 12 9 17 20 6" /></svg>

  return (
    <div className="article-action-row">
      <PrimaryActionSplitButton
        actionLabel={actionLabel}
        onAction={onAction}
        actionIcon={actionIcon}
        variant={variant}
      >
        <button onClick={onToggleClone}><PiGitBranchFill size={14} />Clone</button>
        <button onClick={onFork}><PiGitForkFill size={14} />Fork</button>
        {learnState !== 'UNLEARNED' && (
          <button onClick={onArchive}>
            <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor">
              <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5z"/>
            </svg>
            {archived ? 'Unarchive' : 'Archive'}
          </button>
        )}
        {isDetectingAgents && (
          <button disabled className="split-button-menu-item--scanning">
            <span className="split-button-scanning-spinner" aria-hidden="true" />
            Scanning for agents…
          </button>
        )}
        {canImportAgents && (
          <button onClick={onImportToAgentLibrary}>
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <line x1="12" y1="8" x2="12" y2="20" />
              <polyline points="8 16 12 20 16 16" />
            </svg>
            Import to agent library…
          </button>
        )}
      </PrimaryActionSplitButton>

      <button
        type="button"
        className={`article-action-star${starred ? ' article-action-star--starred' : ''}`}
        onClick={onStar}
        disabled={starWorking}
        aria-label={starred ? 'Unstar' : 'Star'}
        title={starred ? 'Unstar' : 'Star'}
      >
        {starred ? <PiStarFill size={20} /> : <PiStar size={20} />}
      </button>

      {learnState === 'LEARNING' && learnProgress.state && (
        <LearnStatusInline
          phase={learnProgress.state.phase}
          percent={learnProgress.state.percent}
          elapsedMs={learnProgress.elapsedMs}
          state={learnProgress.state.state}
          error={learnProgress.state.error}
        />
      )}

      {translationStatus && (translationStatus.translating || translationStatus.translated) && (
        <div className="article-action-translation">
          <img
            src={logoTransparent}
            alt=""
            className="article-action-translation-logo"
            aria-hidden="true"
          />
          <span className="article-action-translation-text">
            {translationStatus.translating
              ? '⟳ Translating README...'
              : translationStatus.detectedLang === 'switcher'
                ? 'Showing preferred language version'
                : `Translated from ${LANGUAGE_NAMES[translationStatus.detectedLang ?? ''] ?? translationStatus.detectedLang}`
            }
          </span>
          {translationStatus.translated && !translationStatus.translating && (
            <button
              className="article-action-translation-toggle"
              onClick={translationStatus.onToggleOriginal}
            >
              {translationStatus.showOriginal ? 'Show translation' : 'View original'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
