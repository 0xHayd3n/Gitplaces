import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'

type AuthStatus = 'loading' | 'connected' | 'disconnected'

interface GitHubUser {
  login: string
}

interface GitHubAuthContextValue {
  status: AuthStatus
  user: GitHubUser | null
  refresh: () => Promise<void>
}

const GitHubAuthContext = createContext<GitHubAuthContextValue | null>(null)

export function GitHubAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<GitHubUser | null>(null)

  const refresh = useCallback(async () => {
    try {
      const u = await window.api.github.getUser()
      if (u && typeof u.login === 'string') {
        setUser({ login: u.login })
        setStatus('connected')
      } else {
        setUser(null)
        setStatus('disconnected')
      }
    } catch {
      setUser(null)
      setStatus('disconnected')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const value = useMemo(() => ({ status, user, refresh }), [status, user, refresh])

  return (
    <GitHubAuthContext.Provider value={value}>
      {children}
    </GitHubAuthContext.Provider>
  )
}

export function useGitHubAuth(): GitHubAuthContextValue {
  const ctx = useContext(GitHubAuthContext)
  if (!ctx) throw new Error('useGitHubAuth must be used inside GitHubAuthProvider')
  return ctx
}
