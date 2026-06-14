import { lazy, Suspense } from 'react'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import { parseCompareUrl, stripCompareLine } from '../utils/parseCompareUrl'
import { stripMentionsAndRefs } from '../utils/stripMentionsAndRefs'
import { formatBytes } from '../utils/formatBytes'
import { sanitiseRef } from '../../electron/sanitiseRef'
import { CompareSummary } from './CompareSummary'
import { HOST_ID_GITHUB } from '../lib/hostIds'

const ReadmeRenderer = lazy(() => import('./ReadmeRenderer'))

export type VersionLearnState = 'UNLEARNED' | 'LEARNING' | 'LEARNED' | 'ERROR'

interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
  download_count: number
}

interface ReleasePayload {
  release: {
    tag_name: string
    name?: string | null
    body?: string | null
    prerelease?: boolean | null
    assets?: ReleaseAsset[]
  }
}

interface Props {
  event: GitHubFeedEvent
  onLearnVersion?: (tag: string) => void
  learnState?: VersionLearnState
  alreadyLearned?: boolean
}

export function ReleaseModalContent({ event, onLearnVersion, learnState, alreadyLearned }: Props) {
  const release = (event.payload as unknown as ReleasePayload).release
  const rawBody = release.body ?? ''
  const compare = parseCompareUrl(rawBody)
  const withoutCompare = compare ? stripCompareLine(rawBody) : rawBody
  const body = stripMentionsAndRefs(withoutCompare)

  const [owner, name] = event.repo.full_name.split('/')
  const tag = release.tag_name
  const safeTag = sanitiseRef(tag)
  const repoName = name ?? ''
  const showInstall = onLearnVersion !== undefined
  const assets = release.assets ?? []
  const showAssets = showInstall && assets.length > 0

  return (
    <>
      {body && (
        <Suspense fallback={<div className="activity-modal__body-fallback" />}>
          <ReadmeRenderer content={body} repoOwner={owner ?? ''} repoName={repoName} />
        </Suspense>
      )}
      {showInstall && (
        <div className="repo-release-install" style={{ marginTop: 12 }}>
          {alreadyLearned ? (
            <span className="repo-release-installed-label">{repoName}@{safeTag}.skill.md</span>
          ) : learnState === 'LEARNING' ? (
            <span className="repo-release-installing-label">Learning…</span>
          ) : learnState === 'ERROR' ? (
            <button
              className="repo-release-install-btn repo-release-install-btn--error"
              onClick={() => onLearnVersion!(tag)}
            >
              Failed — retry
            </button>
          ) : (
            <button
              className="repo-release-install-btn"
              onClick={() => onLearnVersion!(tag)}
            >
              Learn this version
            </button>
          )}
        </div>
      )}
      {showAssets && (
        <div className="repo-release-assets">
          <div className="repo-release-assets-label">Assets</div>
          {assets.map(a => (
            <a
              key={a.name}
              className="repo-release-asset"
              href={a.browser_download_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="repo-release-asset-name">{a.name}</span>
              <span className="repo-release-asset-size">{formatBytes(a.size)}</span>
              {a.download_count > 0 && (
                <span className="repo-release-asset-downloads">{a.download_count.toLocaleString()} downloads</span>
              )}
            </a>
          ))}
        </div>
      )}
      {compare && compare.kind === 'compare' && (
        <CompareSummary
          hostId={HOST_ID_GITHUB}
          owner={compare.owner}
          repo={compare.repo}
          base={compare.base}
          head={compare.head}
        />
      )}
    </>
  )
}
