import { lazy, Suspense } from 'react'
import type { GitHubFeedEvent } from '../hooks/useFeed'
import { stripMentionsAndRefs } from '../utils/stripMentionsAndRefs'
import { CompareSummary } from './CompareSummary'
import { HOST_ID_GITHUB } from '../lib/hostIds'

const ReadmeRenderer = lazy(() => import('./ReadmeRenderer'))

interface PullRequestPayload {
  action: string
  pull_request: {
    merged: boolean
    title: string
    number: number
    body?: string | null
    user: { login: string; avatar_url: string }
    base: { sha: string; ref: string }
    head: { sha: string; ref: string }
  }
}

interface Props {
  event: GitHubFeedEvent
}

export function PullRequestModalContent({ event }: Props) {
  const pr = (event.payload as unknown as PullRequestPayload).pull_request
  const body = stripMentionsAndRefs(pr.body ?? '')
  const [owner, repo] = event.repo.full_name.split('/')

  return (
    <>
      {body && (
        <Suspense fallback={<div className="activity-modal__body-fallback" />}>
          <ReadmeRenderer content={body} repoOwner={owner ?? ''} repoName={repo ?? ''} />
        </Suspense>
      )}
      <CompareSummary
        hostId={HOST_ID_GITHUB}
        owner={owner ?? ''}
        repo={repo ?? ''}
        base={pr.base.sha}
        head={pr.head.sha}
      />
    </>
  )
}
