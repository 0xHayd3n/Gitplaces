import { useEffect, useState } from 'react'
import './UpdateModal.css'

type CommitSummary = { sha: string; message: string; author: string; date: string }
type Changes = {
  type: 'release' | 'commits'
  releaseNotes?: string
  commits?: CommitSummary[]
  upstreamVersion: string
}

export default function UpdateModal({
  repoId, owner, name, isFork, onClose,
}: {
  repoId: string
  owner: string
  name: string
  isFork: boolean
  onClose: () => void
}) {
  const [changes, setChanges] = useState<Changes | null>(null)
  const [loading, setLoading] = useState(true)
  const [forkApplying, setForkApplying] = useState(false)
  const [regenApplying, setRegenApplying] = useState(false)
  const [forkError, setForkError] = useState<string | null>(null)
  const [regenError, setRegenError] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const isLearned = true // all LibraryRows have installed skills

  useEffect(() => {
    window.api.updates.getChanges(repoId)
      .then((c) => { setChanges(c as Changes); setLoading(false) })
      .catch(() => { setFetchError('Failed to load changes.'); setLoading(false) })
  }, [repoId])

  const handleForkSync = async () => {
    setForkApplying(true)
    setForkError(null)
    const result = await window.api.updates.applyForkSync(repoId)
    setForkApplying(false)
    if (result.ok) onClose()
    else setForkError(result.error ?? 'Sync failed')
  }

  const handleSkillRegen = async () => {
    setRegenApplying(true)
    setRegenError(null)
    const result = await window.api.updates.applySkillRegen(repoId)
    setRegenApplying(false)
    if (result.ok) onClose()
    else setRegenError(result.error ?? 'Regeneration failed')
  }

  return (
    <div className="update-modal-overlay" onClick={onClose}>
      <div className="update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="update-modal-header">
          <h2 className="update-modal-title">Update available — {owner}/{name}</h2>
          <button className="update-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="update-modal-body">
          {loading && <p className="update-modal-loading">Fetching changes…</p>}
          {fetchError && <p className="update-error">{fetchError}</p>}

          {!loading && changes && (
            <>
              {changes.type === 'release' && changes.releaseNotes != null && (
                <div>
                  <p className="update-section-title">Release notes — {changes.upstreamVersion}</p>
                  <pre className="update-release-notes">{changes.releaseNotes || 'No release notes provided.'}</pre>
                </div>
              )}

              {(changes.type === 'commits' || changes.commits) && (changes.commits?.length ?? 0) > 0 && (
                <div>
                  <p className="update-section-title">Recent commits</p>
                  <ul className="update-commits-list">
                    {changes.commits!.map((c) => (
                      <li key={c.sha} className="update-commit">
                        <span className="update-commit-sha">{c.sha}</span>
                        <span className="update-commit-message">{c.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {isFork && (
                <div>
                  <p className="update-section-title">Fork sync</p>
                  {forkError && <p className="update-error">{forkError}</p>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button
                      className="update-btn-apply"
                      onClick={handleForkSync}
                      disabled={forkApplying}
                    >
                      {forkApplying ? 'Syncing…' : 'Sync Fork'}
                    </button>
                  </div>
                </div>
              )}

              {isLearned && (
                <div>
                  <p className="update-section-title">Skill update</p>
                  {regenError && <p className="update-error">{regenError}</p>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button
                      className="update-btn-apply"
                      onClick={handleSkillRegen}
                      disabled={regenApplying}
                    >
                      {regenApplying ? 'Regenerating…' : 'Regenerate Skills'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="update-action-row">
          <button className="update-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
