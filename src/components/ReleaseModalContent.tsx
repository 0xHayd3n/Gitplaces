import { lazy, Suspense } from 'react'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import { parseCompareUrl, stripCompareLine } from '../utils/parseCompareUrl'
import { stripMentionsAndRefs } from '../utils/stripMentionsAndRefs'
import { CompareSummary } from './CompareSummary'

const ReadmeRenderer = lazy(() => import('./ReadmeRenderer'))

interface ReleasePayload {
  release: {
    tag_name: string
    name?: string | null
    body?: string | null
  }
}

interface Props {
  event: GitHubFeedEvent
}

export function ReleaseModalContent({ event }: Props) {
  const release = (event.payload as unknown as ReleasePayload).release
  const rawBody = release.body ?? ''
  const compare = parseCompareUrl(rawBody)
  const withoutCompare = compare ? stripCompareLine(rawBody) : rawBody
  const body = stripMentionsAndRefs(withoutCompare)

  const [owner, name] = event.repo.full_name.split('/')

  return (
    <>
      {body && (
        <Suspense fallback={<div className="activity-modal__body-fallback" />}>
          <ReadmeRenderer content={body} repoOwner={owner ?? ''} repoName={name ?? ''} />
        </Suspense>
      )}
      {compare && compare.kind === 'compare' && (
        <CompareSummary
          owner={compare.owner}
          repo={compare.repo}
          base={compare.base}
          head={compare.head}
        />
      )}
    </>
  )
}
