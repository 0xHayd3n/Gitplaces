import type { GitHubFeedEvent } from '../hooks/useFeed'
import { ForkEventCard } from './ForkEventCard'
import { StarEventCard } from './StarEventCard'
import { BannerCard, type BannerCardProps } from './BannerCard'
import { classifyRelease, type ReleaseTier } from '../utils/classifyRelease'
import { stripMarkdownPreview } from '../utils/stripMarkdownPreview'

interface Props {
  event: GitHubFeedEvent
  onOpenModal: (event: GitHubFeedEvent) => void
}

const PREVIEW_MAX_LENGTH = 240

interface ReleasePayload {
  release: {
    tag_name: string
    name?: string | null
    body?: string | null
    prerelease?: boolean | null
  }
}

interface PullRequestPayload {
  pull_request: {
    title: string
    number: number
    body?: string | null
  }
}

function tierToTagText(tier: ReleaseTier): string {
  if (tier === 'major') return 'MAJOR UPDATE'
  if (tier === 'prerelease') return 'PRE-RELEASE'
  return 'UPDATE'
}

// Direct avatars.githubusercontent.com URL (NOT github.com/<owner>.png, which
// is a 302 redirect; the redirect response lacks Access-Control-Allow-Origin
// and breaks the dither's crossOrigin="anonymous" image load — leaves the
// canvas tainted and produces a blank fallback gradient).
function repoOwnerAvatarUrl(fullName: string): string {
  const owner = fullName.split('/')[0]
  return `https://avatars.githubusercontent.com/${owner}?s=200`
}

export function releaseToBannerProps(
  event: GitHubFeedEvent,
  onOpenModal: (event: GitHubFeedEvent) => void,
): BannerCardProps {
  const release = (event.payload as unknown as ReleasePayload).release
  const tier: ReleaseTier = classifyRelease({
    tagName: release.tag_name,
    prereleaseFlag: release.prerelease === true,
  })
  return {
    tag: tierToTagText(tier),
    tier,
    title: release.tag_name,
    descriptionPreview: stripMarkdownPreview(release.body ?? '', PREVIEW_MAX_LENGTH),
    versionLabel: release.tag_name,
    ownerAvatarUrl: repoOwnerAvatarUrl(event.repo.full_name),
    repoFullName: event.repo.full_name,
    occurredAt: event.created_at,
    onClick: () => onOpenModal(event),
  }
}

function pullRequestToBannerProps(
  event: GitHubFeedEvent,
  onOpenModal: (event: GitHubFeedEvent) => void,
): BannerCardProps {
  const pr = (event.payload as unknown as PullRequestPayload).pull_request
  return {
    tag: 'PR MERGED',
    tier: 'normal',
    title: pr.title,
    descriptionPreview: stripMarkdownPreview(pr.body ?? '', PREVIEW_MAX_LENGTH),
    versionLabel: `#${pr.number}`,
    ownerAvatarUrl: repoOwnerAvatarUrl(event.repo.full_name),
    repoFullName: event.repo.full_name,
    occurredAt: event.created_at,
    onClick: () => onOpenModal(event),
  }
}

export default function ActivityEvent({ event, onOpenModal }: Props) {
  if (event.type === 'ForkEvent') {
    return <ForkEventCard event={event} />
  }
  if (event.type === 'WatchEvent') {
    return <StarEventCard event={event} />
  }
  if (event.type === 'ReleaseEvent') {
    return <BannerCard {...releaseToBannerProps(event, onOpenModal)} />
  }
  if (event.type === 'PullRequestEvent') {
    return <BannerCard {...pullRequestToBannerProps(event, onOpenModal)} />
  }
  return null
}
