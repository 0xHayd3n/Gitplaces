import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfileOverlay } from '../contexts/ProfileOverlay'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import RepoCard, { formatCount } from './RepoCard'
import PersonRow from './PersonRow'
import VerifiedBadge from './VerifiedBadge'
import type { Repo, SavedRepo, User } from '../types/repo'

const TABS = ['Repos', 'Starred', 'Following', 'Followers'] as const
type Tab = typeof TABS[number]

const REPO_SORTS = ['Stars', 'Updated', 'Name'] as const
type RepoSort = typeof REPO_SORTS[number]

const SORT_MAP: Record<RepoSort, string> = {
  Stars: 'stars', Updated: 'updated', Name: 'full_name',  // 'full_name' is GitHub's sort param, not a field access
}

/** Full GitHub-profile shape returned by `profile:getUser` (richer than `User`). */
interface ProfileUser extends User {
  name: string | null
  bio: string | null
  location: string | null
  company: string | null
  blog: string | null
  createdAt: string | null
  htmlUrl: string
  followers: number
  following: number
}

/** Promote a `Repo` to a `SavedRepo` by filling in the library-extras nulls. */
function repoToSavedRepo(r: Repo): SavedRepo {
  return {
    ...r,
    savedAt: null,
    starredAt: null,
    unstarredAt: null,
    discoveredAt: null,
    discoverQuery: null,
    bannerSvg: null,
    bannerColor: null,
    ogImageUrl: null,
    type: null,
    typeBucket: null,
    typeSub: null,
    translatedDescription: null,
    translatedDescriptionLang: null,
    translatedReadme: null,
    translatedReadmeLang: null,
    detectedLanguage: null,
    verificationScore: null,
    verificationTier: null,
    verificationSignals: null,
    verificationCheckedAt: null,
    isForked: null,
    updateAvailable: null,
    updateCheckedAt: null,
    upstreamVersion: null,
    storedVersion: null,
    archivedAt: null,
    forkedAt: null,
    fetchedAt: null,
    starredCheckedAt: null,
    storybookUrl: null,
  }
}

function SkeletonGrid() {
  return (
    <div className="repo-grid">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="repo-card" style={{ minHeight: 180 }}>
          <div style={{ height: 72, background: 'var(--bg3)', animation: 'shimmer 1.4s infinite linear' }} />
          <div className="repo-card-panel">
            <div style={{ height: 13, width: '60%', background: 'var(--bg3)', borderRadius: 4, marginBottom: 8, animation: 'shimmer 1.4s infinite linear' }} />
            <div style={{ height: 11, width: '40%', background: 'var(--bg3)', borderRadius: 4, animation: 'shimmer 1.4s infinite linear' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function SkeletonHeader() {
  return (
    <div className="profile-identity-row">
      <div className="profile-skeleton-avatar" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="profile-skeleton-line" style={{ width: 180 }} />
        <div className="profile-skeleton-line" style={{ width: 120 }} />
        <div className="profile-skeleton-line" style={{ width: 260 }} />
      </div>
    </div>
  )
}

export default function ProfileOverlay() {
  const { profileState, popProfile, closeProfile, setStackAt, pushProfile } = useProfileOverlay()
  const { stack, currentUsername } = profileState

  const [user, setUser] = useState<ProfileUser | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('Repos')
  const [isVerified, setIsVerified] = useState(false)

  // Reset tab + re-fetch when username changes
  useEffect(() => {
    let isMounted = true
    setUser(null)
    setLoadingUser(true)
    setActiveTab('Repos')
    setIsVerified(false)
    window.api.profile.getUser(currentUsername)
      .then(data => { if (isMounted) setUser(data as ProfileUser) })
      .catch(() => { if (isMounted) setUser(null) })
      .finally(() => { if (isMounted) setLoadingUser(false) })
    // Non-blocking: fetch verified status after profile renders
    window.api.org.getVerified(currentUsername)
      .then(v => { if (isMounted && v) setIsVerified(true) })
      .catch(() => {})
    return () => { isMounted = false }
  }, [currentUsername])

  const counts: Partial<Record<Tab, number>> = {
    Repos:     user?.publicRepos,
    Followers: user?.followers,
    Following: user?.following,
  }

  return (
    <div className="profile-overlay">
      {/* ── Nav bar ── */}
      <div className="profile-nav-bar">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {stack.length > 1 && (
            <button className="btn-back" onClick={popProfile}>← Back</button>
          )}
          <div className="profile-breadcrumb">
            {stack.map((username, i) => (
              <span key={`${username}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span style={{ opacity: 0.4 }}>›</span>}
                <button
                  className={`profile-breadcrumb-item${i === stack.length - 1 ? ' current' : ''}`}
                  onClick={() => i < stack.length - 1 && setStackAt(i, username)}
                >
                  {username}
                </button>
              </span>
            ))}
          </div>
        </div>
        <button className="btn-close-overlay" onClick={closeProfile}>✕</button>
      </div>

      {/* ── Profile identity ── */}
      {loadingUser ? (
        <SkeletonHeader />
      ) : user ? (
        <ProfileHeader user={user} currentUsername={currentUsername} isVerified={isVerified} />
      ) : (
        <div style={{ padding: '20px 24px', color: 'var(--t3)', fontSize: 13 }}>
          Could not load profile for @{currentUsername}
        </div>
      )}

      {/* ── Tab bar ── */}
      <div className="profile-tab-bar">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`profile-tab-btn${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            {counts[tab] != null && (
              <span className="profile-tab-count">{formatCount(counts[tab])}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="profile-tab-content">
        {activeTab === 'Repos'     && <ReposTab username={currentUsername} />}
        {activeTab === 'Starred'   && <StarredTab username={currentUsername} />}
        {activeTab === 'Following' && <PeopleTab username={currentUsername} kind="following" onOpenProfile={pushProfile} />}
        {activeTab === 'Followers' && <PeopleTab username={currentUsername} kind="followers" onOpenProfile={pushProfile} />}
      </div>
    </div>
  )
}

// ── ProfileHeader ─────────────────────────────────────────────────
function ProfileHeader({ user, currentUsername, isVerified }: { user: ProfileUser; currentUsername: string; isVerified: boolean }) {
  const auth = useGitHubAuth()
  const loggedInUsername = auth.user?.login ?? ''
  const [following, setFollowing] = useState(false)
  const [followLoading, setFollowLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    setFollowLoading(true)
    window.api.profile.isFollowing(currentUsername)
      .then(v => { if (isMounted) setFollowing(v) })
      .catch(() => { if (isMounted) setFollowing(false) })
      .finally(() => { if (isMounted) setFollowLoading(false) })
    return () => { isMounted = false }
  }, [currentUsername])

  const handleFollowToggle = async () => {
    const was = following
    setFollowing(!was)
    try {
      if (was) await window.api.profile.unfollow(currentUsername)
      else      await window.api.profile.follow(currentUsername)
    } catch {
      setFollowing(was)
    }
  }

  const isOwnProfile = loggedInUsername === currentUsername

  return (
    <div className="profile-identity-row">
      <img src={user.avatarUrl} alt={user.login} className="profile-avatar" />
      <div className="profile-meta">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="profile-display-name">{user.name ?? user.login}</div>
          {isVerified && <VerifiedBadge size={14} />}
        </div>
        <div className="profile-login">@{user.login}</div>
        {user.bio && <div className="profile-bio">{user.bio}</div>}
        <div className="profile-stats">
          <span><strong>{formatCount(user.followers)}</strong> followers</span>
          <span><strong>{formatCount(user.following)}</strong> following</span>
          {user.location && <span>📍 {user.location}</span>}
          {user.company && <span>{user.company.replace(/^@/, '')}</span>}
        </div>
      </div>
      {!isOwnProfile && !followLoading && (
        <button
          className={following ? 'btn-following' : 'btn-follow'}
          onClick={handleFollowToggle}
        >
          {following ? 'Following ✓' : '+ Follow'}
        </button>
      )}
    </div>
  )
}

function ReposTab({ username }: { username: string }) {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<RepoSort>('Stars')
  const navigate = useNavigate()

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    window.api.profile.getUserRepos(username, SORT_MAP[sort])
      .then((data: Repo[]) => { if (isMounted) setRepos(data) })
      .catch(() => { if (isMounted) setRepos([]) })
      .finally(() => { if (isMounted) setLoading(false) })
    return () => { isMounted = false }
  }, [username, sort])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 24px 0', gap: 8 }}>
        {REPO_SORTS.map(s => (
          <button
            key={s}
            className={`discover-sort-btn${sort === s ? ' active' : ''}`}
            onClick={() => setSort(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <div style={{ padding: '12px 24px 24px' }}>
        {loading ? (
          <SkeletonGrid />
        ) : repos.length === 0 ? (
          <p style={{ color: 'var(--t3)', fontSize: 13 }}>No public repos.</p>
        ) : (
          <div className="repo-grid">
            {repos.map(r => {
              const saved = repoToSavedRepo(r)
              return (
                <RepoCard
                  key={saved.fullName}
                  repo={saved}
                  onNavigate={navigate}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StarredTab({ username }: { username: string }) {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<'Stars' | 'Recent'>('Stars')
  const navigate = useNavigate()

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    window.api.profile.getStarred(username)
      .then((data: Repo[]) => { if (isMounted) setRepos(data) })
      .catch(() => { if (isMounted) setRepos([]) })
      .finally(() => { if (isMounted) setLoading(false) })
    return () => { isMounted = false }
  }, [username])

  const sorted = [...repos].sort((a, b) =>
    sort === 'Stars'
      ? (b.stars ?? 0) - (a.stars ?? 0)
      : new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 24px 0', gap: 8 }}>
        {(['Stars', 'Recent'] as const).map(s => (
          <button key={s} className={`discover-sort-btn${sort === s ? ' active' : ''}`} onClick={() => setSort(s)}>{s}</button>
        ))}
      </div>
      <div style={{ padding: '12px 24px 24px' }}>
        {loading ? <SkeletonGrid /> : sorted.length === 0 ? (
          <p style={{ color: 'var(--t3)', fontSize: 13 }}>No starred repos yet.</p>
        ) : (
          <div className="repo-grid">
            {sorted.map(r => {
              const saved = repoToSavedRepo(r)
              return (
                <RepoCard key={saved.fullName} repo={saved} onNavigate={navigate} />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** Wraps PersonRow and fetches verified status non-blocking per person. */
function PersonRowVerified(props: React.ComponentPropsWithoutRef<typeof PersonRow> & { login: string }) {
  const { login, ...rest } = props
  const [isVerified, setIsVerified] = useState(false)
  useEffect(() => {
    window.api.org.getVerified(login)
      .then(v => { if (v) setIsVerified(true) })
      .catch(() => {})
  }, [login])
  return <PersonRow {...rest} isVerified={isVerified} />
}

function PeopleTab({ username, kind, onOpenProfile }: {
  username: string
  kind: 'following' | 'followers'
  onOpenProfile: (u: string) => void
}) {
  const auth = useGitHubAuth()
  const loggedInUser = auth.user?.login ?? ''
  const [people, setPeople]             = useState<User[]>([])
  const [loading, setLoading]           = useState(true)
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set())

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    const fetch = kind === 'following'
      ? window.api.profile.getFollowing(username)
      : window.api.profile.getFollowers(username)
    fetch
      .then(async (list: User[]) => {
        if (!isMounted) return
        setPeople(list)
        try {
          // Seed followingSet: check which ones the logged-in user follows
          const checks = await Promise.all(list.map(p => window.api.profile.isFollowing(p.login)))
          if (!isMounted) return
          const set = new Set<string>()
          list.forEach((p, i) => { if (checks[i]) set.add(p.login) })
          setFollowingSet(set)
        } catch {
          // isFollowing checks failed — people list still shown, followingSet stays empty
        }
      })
      .catch(() => { if (isMounted) setPeople([]) })
      .finally(() => { if (isMounted) setLoading(false) })
    return () => { isMounted = false }
  }, [username, kind])

  const handleFollowToggle = async (login: string) => {
    const was = followingSet.has(login)
    setFollowingSet(prev => {
      const next = new Set(prev)
      was ? next.delete(login) : next.add(login)
      return next
    })
    try {
      if (was) await window.api.profile.unfollow(login)
      else      await window.api.profile.follow(login)
    } catch {
      setFollowingSet(prev => {
        const next = new Set(prev)
        was ? next.add(login) : next.delete(login)
        return next
      })
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '12px 24px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg3)', flexShrink: 0, animation: 'shimmer 1.4s infinite linear' }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ height: 12, width: '30%', background: 'var(--bg3)', borderRadius: 4, animation: 'shimmer 1.4s infinite linear' }} />
              <div style={{ height: 10, width: '20%', background: 'var(--bg3)', borderRadius: 4, animation: 'shimmer 1.4s infinite linear' }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (people.length === 0) {
    return <p style={{ padding: '20px 24px', color: 'var(--t3)', fontSize: 13 }}>No {kind} yet.</p>
  }

  return (
    <div style={{ padding: '12px 24px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {people.map((person) => (
        <PersonRowVerified
          key={person.login}
          login={person.login}
          user={person}
          isFollowing={followingSet.has(person.login)}
          isOwnProfile={loggedInUser === person.login}
          onOpenProfile={() => onOpenProfile(person.login)}
          onFollowToggle={() => handleFollowToggle(person.login)}
        />
      ))}
    </div>
  )
}
