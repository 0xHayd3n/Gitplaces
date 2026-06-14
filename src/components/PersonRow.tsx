import type { User } from '../types/repo'
import VerifiedBadge from './VerifiedBadge'

/** Person-list entries may carry name/bio sourced from a richer profile lookup;
 *  the base `User` shape from `profile:getFollowing`/`getFollowers` does not. */
type PersonUser = User & {
  name?: string | null
  bio?: string | null
}

interface PersonRowProps {
  user: PersonUser
  isFollowing: boolean
  isOwnProfile: boolean
  isVerified?: boolean            // optional — defaults to false; only show if explicitly confirmed
  onOpenProfile: () => void
  onFollowToggle: () => void   // called without event — stopPropagation handled internally
}

export default function PersonRow({ user, isFollowing, isOwnProfile, isVerified = false, onOpenProfile, onFollowToggle }: PersonRowProps) {
  return (
    <div className="person-row" onClick={onOpenProfile}>
      <img src={user.avatarUrl} alt={user.login} className="person-row-avatar" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div className="person-row-name">{user.name ?? user.login}</div>
          {isVerified && <VerifiedBadge size={11} />}
        </div>
        <div className="person-row-login">@{user.login}</div>
        {user.bio && <div className="person-row-bio">{user.bio}</div>}
      </div>
      <button
        className={isFollowing ? 'btn-following' : 'btn-follow'}
        style={{ fontSize: 11, padding: '5px 12px' }}
        disabled={isOwnProfile}
        onClick={(e) => { e.stopPropagation(); if (!isOwnProfile) onFollowToggle() }}
      >
        {isOwnProfile ? 'You' : isFollowing ? 'Following ✓' : '+ Follow'}
      </button>
    </div>
  )
}
