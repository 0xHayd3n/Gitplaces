import type { GitHubFeedEvent } from '../hooks/useFeed'
import './ActivityEvent.css'
import { ForkEventCard } from './ForkEventCard'
import { StarEventCard } from './StarEventCard'
import { BannerCard, type BannerCardTier } from './BannerCard'
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

function releaseToBannerProps(
  event: GitHubFeedEvent,
  onOpenModal: (event: GitHubFeedEvent) => void,
) {
  const release = (event.payload as unknown as ReleasePayload).release
  const tier: ReleaseTier = classifyRelease({
    tagName: release.tag_name,
    prereleaseFlag: release.prerelease === true,
  })
  const trimmedName = release.name?.trim()
  const titleSuffix = trimmedName && trimmedName !== release.tag_name
    ? ` — ${trimmedName}`
    : ''
  const [ownerLogin] = event.repo.full_name.split('/')

  return {
    tag: tierToTagText(tier),
    tier: tier as BannerCardTier,
    title: `${release.tag_name}${titleSuffix}`,
    descriptionPreview: stripMarkdownPreview(release.body ?? '', PREVIEW_MAX_LENGTH),
    versionLabel: release.tag_name,
    ownerLogin: ownerLogin ?? '',
    repoFullName: event.repo.full_name,
    occurredAt: event.created_at,
    onClick: () => onOpenModal(event),
  }
}

function pullRequestToBannerProps(
  event: GitHubFeedEvent,
  onOpenModal: (event: GitHubFeedEvent) => void,
) {
  const pr = (event.payload as unknown as PullRequestPayload).pull_request
  const [ownerLogin] = event.repo.full_name.split('/')
  return {
    tag: 'PR MERGED',
    tier: 'normal' as BannerCardTier,
    title: pr.title,
    descriptionPreview: stripMarkdownPreview(pr.body ?? '', PREVIEW_MAX_LENGTH),
    versionLabel: `#${pr.number}`,
    ownerLogin: ownerLogin ?? '',
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
