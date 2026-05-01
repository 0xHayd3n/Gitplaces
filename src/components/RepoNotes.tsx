import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  repoId: string
  owner: string
  repoName: string
}

type SaveStatus = 'idle' | 'saving' | 'saved'

export default function RepoNotes({ repoId, owner, repoName }: Props) {
  const [notes, setNotes] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [row, status] = await Promise.all([
        (window as any).api.notes.get(repoId) as Promise<{ notes: string; updated_at: number } | null>,
        (window as any).api.skillSync.getStatus() as Promise<{ enabled: boolean }>,
      ])
      if (cancelled) return
      setNotes(row?.notes ?? null)
      if (status.enabled && row !== null) {
        const result = await (window as any).api.notes.pullFromGitHub(repoId, owner, repoName) as
          { action: string; notes?: string }
        if (!cancelled && result.action === 'updated' && result.notes !== undefined) {
          setNotes(result.notes)
        }
      }
    })()
    return () => { cancelled = true }
  }, [repoId, owner, repoName])

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  function handleChange(value: string) {
    setNotes(value)
    setSaveStatus('saving')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      await (window as any).api.notes.set(repoId, value)
      setSaveStatus('saved')
    }, 1500)
  }

  return (
    <div className="repo-notes-tile">
      <div className="repo-notes-header">
        <span className="repo-notes-label">Notes</span>
        {saveStatus === 'saving' && (
          <span className="repo-notes-save-status saving">saving...</span>
        )}
        {saveStatus === 'saved' && (
          <span className="repo-notes-save-status">✓ saved</span>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            ref={textareaRef}
            className="repo-notes-textarea"
            value={notes ?? ''}
            onChange={e => handleChange(e.target.value)}
            onBlur={() => setEditing(false)}
          />
          <div className="repo-notes-edit-hint">Click outside to close</div>
        </>
      ) : notes === null || notes === '' ? (
        <div className="repo-notes-empty" onClick={() => setEditing(true)}>
          Click to add notes... (markdown supported)
        </div>
      ) : (
        <div className="repo-notes-preview" onClick={() => setEditing(true)}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}
