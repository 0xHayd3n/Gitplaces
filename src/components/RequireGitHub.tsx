import type { ReactNode } from 'react'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import GitHubLoginPrompt from './GitHubLoginPrompt'

export default function RequireGitHub({ children }: { children: ReactNode }) {
  const { status } = useGitHubAuth()
  if (status === 'loading') return null
  if (status === 'disconnected') return <GitHubLoginPrompt />
  return <>{children}</>
}
