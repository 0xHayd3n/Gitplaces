import { memo } from 'react'
import { relativeTime } from '../utils/relativeTime'
import type { RepoUserEvent } from '../types/repoUserEvents'
import './RepoUserEventRow.css'

interface Props {
  event: RepoUserEvent
  repoOwner: string
  repoName: string
  userLogin: string
  userAvatarUrl: string
}

export const RepoUserEventRow = memo(function RepoUserEventRow({
  event, repoOwner, repoName, userLogin, userAvatarUrl,
}: Props) {
  const { verb, chip, actor } = buildContent(event, repoOwner, repoName, userLogin)
  const displayLogin = actor?.login ?? userLogin
  const displayAvatar = actor?.avatarUrl ?? userAvatarUrl
  return (
    <div className="repo-user-event">
      <img src={displayAvatar} alt={displayLogin} className="repo-user-event__avatar" loading="lazy" decoding="async" />
      <span className="repo-user-event__user">{displayLogin}</span>
      <span className="repo-user-event__verb">{verb}</span>
      {chip}
      <span className="repo-user-event__time">{relativeTime(event.ts)}</span>
    </div>
  )
})

function buildContent(
  event: RepoUserEvent,
  repoOwner: string,
  repoName: string,
  userLogin: string,
): { verb: string; chip: React.ReactNode; actor?: { login: string; avatarUrl: string } } {
  const repoAvatar = `https://avatars.githubusercontent.com/${repoOwner}?s=64`
  const userAvatar = `https://avatars.githubusercontent.com/${userLogin}?s=64`

  switch (event.type) {
    case 'star':
      return { verb: 'starred', chip: <RepoChip avatar={repoAvatar} text={`${repoOwner}/${repoName}`} /> }
    case 'archive':
      return { verb: 'archived', chip: <RepoChip avatar={repoAvatar} text={`${repoOwner}/${repoName}`} /> }
    case 'fork':
      return { verb: 'forked this to', chip: <RepoChip avatar={userAvatar} text={`${userLogin}/${repoName}`} /> }
    case 'learn':
      return {
        verb: event.skillType === 'components' ? 'learned components for' : 'learned',
        chip: <RepoChip avatar={repoAvatar} text={`${repoOwner}/${repoName}`} />,
      }
    case 'created':
      return {
        verb: 'created',
        chip: <RepoChip avatar={repoAvatar} text={`${repoOwner}/${repoName}`} />,
        actor: { login: repoOwner, avatarUrl: repoAvatar },
      }
  }
}

function RepoChip({ avatar, text }: { avatar: string; text: string }) {
  return (
    <span className="repo-user-event__chip repo-user-event__chip--repo">
      <img src={avatar} alt="" className="repo-user-event__chip-avatar" loading="lazy" decoding="async" />
      <span>{text}</span>
    </span>
  )
}
