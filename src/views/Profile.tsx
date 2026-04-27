import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfileOverlay } from '../contexts/ProfileOverlay'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import RepoCard, { formatCount } from '../components/RepoCard'
import PersonRow from '../components/PersonRow'
import React from 'react'

// ── Types ────────────────────────────────────────────────────────

interface GithubApiRepo {
  id: number
  name: string
  description: string | null
  language: string | null
  topics?: string[]
  stargazers_count: number | null
  forks_count: number | null
  watchers_count: number | null
  size: number | null
  open_issues_count: number | null
  homepage: string | null
  updated_at: string | null
  pushed_at: string | null
  default_branch: string | null
  owner?: { login: string; avatar_url?: string }
  license?: { spdx_id: string } | null
}

// ── Helpers ──────────────────────────────────────────────────────

function apiRepoToRow(r: GithubApiRepo) {
  return {
    id: String(r.id), owner: r.owner?.login ?? '', name: r.name,
    description: r.description ?? null, language: r.language ?? null,
    topics: JSON.stringify(r.topics ?? []),
    stars: r.stargazers_count ?? null, forks: r.forks_count ?? null,
    license: r.license?.spdx_id ?? null, homepage: r.homepage ?? null,
    updated_at: r.updated_at ?? null, pushed_at: r.pushed_at ?? null,
    saved_at: null, type: null, banner_svg: null, discovered_at: null,
    discover_query: null, watchers: r.watchers_count ?? null,
    size: r.size ?? null, open_issues: r.open_issues_count ?? null,
    starred_at: null, unstarred_at: null, default_branch: r.default_branch ?? 'main',
    avatar_url: r.owner?.avatar_url ?? null, banner_color: null,
    translated_description: null, translated_description_lang: null,
    translated_readme: null, translated_readme_lang: null,
    detected_language: null, verification_score: null,
    verification_tier: null, verification_signals: null,
    verification_checked_at: null, type_bucket: null, type_sub: null,
  }
}

function formatJoined(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `Joined ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
}

// ── Skeleton ────────────────────────────────────────────────────

function SidebarSkeleton() {
  return (
    <>
      <div className="profile-view-avatar-skeleton" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <div className="profile-view-skeleton-line" style={{ width: 110 }} />
        <div className="profile-view-skeleton-line" style={{ width: 70 }} />
      </div>
    </>
  )
}

// ── Tabs config ──────────────────────────────────────────────────

const TABS = ['Repos', 'Starred', 'Following', 'Followers'] as const
type Tab = typeof TABS[number]

// ── Profile view ──────────────────────────────────────────────────

export default function Profile() {
  const auth = useGitHubAuth()
  const login = auth.user?.login ?? ''
  const [user, setUser]               = useState<GitHubUser | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)
  const [userError, setUserError]     = useState(false)
  const [activeTab, setActiveTab]     = useState<Tab>('Repos')
  const [visited, setVisited]         = useState<Set<Tab>>(new Set(['Repos']))

  useEffect(() => {
    if (!login) return
    let isMounted = true
    window.api.profile.getUser(login)
      .then((data: GitHubUser) => { if (isMounted) setUser(data) })
      .catch(() => { if (isMounted) setUserError(true) })
      .finally(() => { if (isMounted) setLoadingUser(false) })
    return () => { isMounted = false }
  }, [login])

  const counts: Partial<Record<Tab, number>> = {
    Repos:     user?.public_repos,
    Following: user?.following,
    Followers: user?.followers,
  }

  return (
    <div className="profile-view">
      {/* ── Sidebar ── */}
      <aside className="profile-sidebar">
        {loadingUser ? (
          <SidebarSkeleton />
        ) : userError || !user ? (
          <p className="profile-view-error" style={{ color: 'var(--t3)', fontSize: 12 }}>Could not load profile.</p>
        ) : (
          <>
            <img src={user.avatar_url} alt={user.login} className="profile-view-avatar" />
            <div>
              <div className="profile-view-name">{user.name ?? user.login}</div>
              <div className="profile-view-username">@{user.login}</div>
            </div>
            {user.bio && <div className="profile-view-bio">{user.bio}</div>}
            <div className="profile-view-meta">
              {user.location && (
                <div className="profile-view-meta-row">
                  <span>📍</span><span>{user.location}</span>
                </div>
              )}
              {user.company && (
                <div className="profile-view-meta-row">
                  <span>🏢</span><span>{user.company.replace(/^@/, '')}</span>
                </div>
              )}
              {user.blog && (
                <div className="profile-view-meta-row">
                  <span>🔗</span>
                  <a href={user.blog} onClick={e => { e.preventDefault(); window.api.openExternal(user.blog as string) }}>
                    {user.blog.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              )}
              {user.created_at && (
                <div className="profile-view-meta-row">
                  <span>📅</span><span>{formatJoined(user.created_at)}</span>
                </div>
              )}
            </div>
            <div className="profile-view-stats">
              <div className="profile-view-stat">
                <span className="profile-view-stat-value">{formatCount(user.followers)}</span>
                <span className="profile-view-stat-label">followers</span>
              </div>
              <div className="profile-view-stat">
                <span className="profile-view-stat-value">{formatCount(user.following)}</span>
                <span className="profile-view-stat-label">following</span>
              </div>
            </div>
            <button
              className="profile-view-edit-btn"
              onClick={() => window.api.openExternal(user.html_url)}
            >
              Edit on GitHub ↗
            </button>
          </>
        )}
      </aside>

      {/* ── Right content ── */}
      <div className="profile-content">
        {/* Tab bar */}
        <div className="profile-view-tabs">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`profile-view-tab${activeTab === tab ? ' active' : ''}`}
              onClick={() => {
                setActiveTab(tab)
                setVisited(prev => new Set([...prev, tab]))
              }}
            >
              {tab}
              {counts[tab] != null && (
                <span className="profile-view-tab-count">{formatCount(counts[tab])}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab panels — visited-set caching keeps mounted panels alive via display:none */}
        <div className="profile-view-tab-panel">
          {TABS.map(tab => (
            <div key={tab} style={{ display: activeTab === tab ? 'block' : 'none', height: '100%' }}>
              {login && visited.has(tab) && tab === 'Repos'     && <ReposTab     login={login} />}
              {login && visited.has(tab) && tab === 'Starred'   && <StarredTab   login={login} />}
              {login && visited.has(tab) && tab === 'Following' && <PeopleTab    login={login} kind="following" />}
              {login && visited.has(tab) && tab === 'Followers' && <PeopleTab    login={login} kind="followers" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const REPO_SORTS = ['Stars', 'Updated', 'Name'] as const
type RepoSort = typeof REPO_SORTS[number]
const SORT_MAP: Record<RepoSort, string> = {
  Stars: 'stars', Updated: 'updated', Name: 'full_name',
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

function ReposTab({ login }: { login: string }) {
  const [repos, setRepos]      = useState<GithubApiRepo[]>([])
  const [loading, setLoading]  = useState(true)
  const [error, setError]      = useState(false)
  const [sort, setSort]        = useState<RepoSort>('Stars')
  const [retryCount, setRetry] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(false)
    window.api.profile.getUserRepos(login, SORT_MAP[sort])
      .then((data: GithubApiRepo[]) => { if (isMounted) setRepos(data) })
      .catch(() => { if (isMounted) setError(true) })
      .finally(() => { if (isMounted) setLoading(false) })
    return () => { isMounted = false }
  }, [login, sort, retryCount])

  if (error) return (
    <div className="profile-view-error">
      <span>Could not load repositories.</span>
      <button className="profile-view-retry-btn" onClick={() => setRetry(n => n + 1)}>Retry</button>
    </div>
  )

  return (
    <div>
      <div className="profile-view-sort-bar">
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
      <div className="profile-view-content-pad">
        {loading ? (
          <SkeletonGrid />
        ) : repos.length === 0 ? (
          <p className="profile-view-empty">No repositories yet.</p>
        ) : (
          <div className="repo-grid">
            {repos.map(r => {
              const row = apiRepoToRow(r)
              return <RepoCard key={row.id} repo={row} onNavigate={navigate} onTagClick={() => {}} />
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StarredTab({ login }: { login: string }) {
  const [repos, setRepos]      = useState<GithubApiRepo[]>([])
  const [loading, setLoading]  = useState(true)
  const [error, setError]      = useState(false)
  const [sort, setSort]        = useState<'Stars' | 'Recent'>('Stars')
  const [retryCount, setRetry] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(false)
    window.api.profile.getStarred(login)
      .then((data: GithubApiRepo[]) => { if (isMounted) setRepos(data) })
      .catch(() => { if (isMounted) setError(true) })
      .finally(() => { if (isMounted) setLoading(false) })
    return () => { isMounted = false }
  }, [login, retryCount])

  const sorted = [...repos].sort((a, b) =>
    sort === 'Stars'
      ? (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0)
      : new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
  )

  if (error) return (
    <div className="profile-view-error">
      <span>Could not load starred repos.</span>
      <button className="profile-view-retry-btn" onClick={() => setRetry(n => n + 1)}>Retry</button>
    </div>
  )

  return (
    <div>
      <div className="profile-view-sort-bar">
        {(['Stars', 'Recent'] as const).map(s => (
          <button key={s} className={`discover-sort-btn${sort === s ? ' active' : ''}`} onClick={() => setSort(s)}>{s}</button>
        ))}
      </div>
      <div className="profile-view-content-pad">
        {loading ? <SkeletonGrid /> : sorted.length === 0 ? (
          <p className="profile-view-empty">No starred repos yet.</p>
        ) : (
          <div className="repo-grid">
            {sorted.map(r => {
              const row = apiRepoToRow(r)
              return <RepoCard key={row.id} repo={row} onNavigate={navigate} onTagClick={() => {}} />
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function PersonRowVerified(props: React.ComponentPropsWithoutRef<typeof PersonRow> & { login: string }) {
  const { login, ...rest } = props
  const [isVerified, setIsVerified] = useState(false)
  useEffect(() => {
    let isMounted = true
    window.api.org.getVerified(login)
      .then((v: boolean) => { if (isMounted && v) setIsVerified(true) })
      .catch(() => {})
    return () => { isMounted = false }
  }, [login])
  return <PersonRow {...rest} isVerified={isVerified} />
}

function PeopleTab({ login, kind }: { login: string; kind: 'following' | 'followers' }) {
  const { openProfile }                 = useProfileOverlay()
  const [people, setPeople]             = useState<any[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(false)
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set())
  const [retryCount, setRetry]          = useState(0)

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(false)
    const fetch = kind === 'following'
      ? window.api.profile.getFollowing(login)
      : window.api.profile.getFollowers(login)
    fetch
      .then(async (list: any[]) => {
        if (!isMounted) return
        setPeople(list)
        try {
          const checks = await Promise.all(list.map((p: any) => window.api.profile.isFollowing(p.login)))
          if (!isMounted) return
          const set = new Set<string>()
          list.forEach((p: any, i: number) => { if (checks[i]) set.add(p.login) })
          setFollowingSet(set)
        } catch { /* people list still shown */ }
      })
      .catch(() => { if (isMounted) setError(true) })
      .finally(() => { if (isMounted) setLoading(false) })
    return () => { isMounted = false }
  }, [login, kind, retryCount])

  const handleFollowToggle = async (personLogin: string) => {
    const was = followingSet.has(personLogin)
    setFollowingSet(prev => {
      const next = new Set(prev)
      was ? next.delete(personLogin) : next.add(personLogin)
      return next
    })
    try {
      if (was) await window.api.profile.unfollow(personLogin)
      else      await window.api.profile.follow(personLogin)
    } catch {
      setFollowingSet(prev => {
        const next = new Set(prev)
        was ? next.add(personLogin) : next.delete(personLogin)
        return next
      })
    }
  }

  if (error) return (
    <div className="profile-view-error">
      <span>Could not load {kind}.</span>
      <button className="profile-view-retry-btn" onClick={() => setRetry(n => n + 1)}>Retry</button>
    </div>
  )

  if (loading) return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
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

  if (people.length === 0) return (
    <p className="profile-view-empty">No {kind} yet.</p>
  )

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {people.map((person) => (
        <PersonRowVerified
          key={person.login}
          login={person.login}
          user={person}
          isFollowing={followingSet.has(person.login)}
          isOwnProfile={login === person.login}
          onOpenProfile={() => openProfile(person.login)}
          onFollowToggle={() => handleFollowToggle(person.login)}
        />
      ))}
    </div>
  )
}
