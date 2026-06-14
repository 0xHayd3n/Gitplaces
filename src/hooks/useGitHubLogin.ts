import { useCallback, useEffect, useRef, useState } from 'react'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import { HOST_ID_GITHUB } from '../lib/hostIds'

export type LoginStatus = 'idle' | 'pending' | 'polling' | 'success' | 'error'

interface UseGitHubLoginResult {
  status: LoginStatus
  userCode: string | null
  verificationUri: string | null
  verificationUriComplete: string | null
  error: string | null
  start: () => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
}

export function useGitHubLogin(): UseGitHubLoginResult {
  const { refresh } = useGitHubAuth()
  const [status, setStatus] = useState<LoginStatus>('idle')
  const [userCode, setUserCode] = useState<string | null>(null)
  const [verificationUri, setVerificationUri] = useState<string | null>(null)
  const [verificationUriComplete, setVerificationUriComplete] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activeRef = useRef(false)

  useEffect(() => {
    return () => {
      if (activeRef.current) {
        window.api.hosts.cancelDeviceFlow(HOST_ID_GITHUB)?.catch?.(() => {})
      }
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setUserCode(null)
    setVerificationUri(null)
    setVerificationUriComplete(null)
    setStatus('pending')
    activeRef.current = true
    try {
      const flow = await window.api.hosts.startDeviceFlow(HOST_ID_GITHUB)
      setUserCode(flow.userCode)
      setVerificationUri(flow.verificationUri)
      setVerificationUriComplete(flow.verificationUriComplete)
      setStatus('polling')
      await window.api.hosts.pollDeviceToken(HOST_ID_GITHUB, flow.deviceCode, flow.interval)
      await refresh()
      window.api.settings.set('onboarding_complete', '1').catch(() => {})
      setStatus('success')
      setUserCode(null)
      setVerificationUri(null)
      setVerificationUriComplete(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const lower = message.toLowerCase()
      if (lower.includes('abort') || lower.includes('cancel')) {
        setStatus('idle')
      } else {
        setError('Connection failed — please try again.')
        setStatus('error')
      }
      setUserCode(null)
      setVerificationUri(null)
      setVerificationUriComplete(null)
    } finally {
      activeRef.current = false
    }
  }, [refresh])

  const cancel = useCallback(async () => {
    if (!activeRef.current) return
    await window.api.hosts.cancelDeviceFlow(HOST_ID_GITHUB)?.catch?.(() => {})
    activeRef.current = false
    setStatus('idle')
    setUserCode(null)
    setVerificationUri(null)
    setVerificationUriComplete(null)
    setError(null)
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setError(null)
    setUserCode(null)
    setVerificationUri(null)
    setVerificationUriComplete(null)
  }, [])

  return { status, userCode, verificationUri, verificationUriComplete, error, start, cancel, reset }
}
