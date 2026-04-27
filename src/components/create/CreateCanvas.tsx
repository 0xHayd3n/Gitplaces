import { useState, useEffect } from 'react'
import CreateMetaBar from './CreateMetaBar'
import RepoBrowser from './RepoBrowser'
import AiChatPanel from './AiChatPanel'
import PreviewAdapter from './preview/PreviewAdapter'
import FileStrip from './FileStrip'
import type { CreateSession, CreateMessage } from '../../types/create'

interface Props { sessionId: string }

type SessionWithMeta = CreateSession & { files?: string[]; dirty?: boolean; pendingChanges?: string[] }

export default function CreateCanvas({ sessionId }: Props) {
  const [session, setSession] = useState<SessionWithMeta | null>(null)
  const [streamingToken, setStreamingToken] = useState('')
  const [inspectFile, setInspectFile] = useState<string | null>(null)
  const [inspectContent, setInspectContent] = useState('')

  useEffect(() => {
    window.api.create.getSession(sessionId).then(s => setSession(s as SessionWithMeta))
  }, [sessionId])

  useEffect(() => {
    const cb = (data: { sessionId: string; token: string }) => {
      if (data.sessionId === sessionId) setStreamingToken(t => t + data.token)
    }
    window.api.create.onStreamToken(cb)
    return () => window.api.create.offStreamToken(cb)
  }, [sessionId])

  async function handleFileClick(filePath: string) {
    if (!session?.localPath) return
    const content = await window.api.create.getFileContent(session.localPath, filePath)
    setInspectFile(filePath)
    setInspectContent(content)
  }

  function handleMessageSent(updatedHistory: CreateMessage[], changedFiles: string[]) {
    setStreamingToken('')
    setSession(prev => prev ? {
      ...prev,
      chatHistory: updatedHistory,
      files: [...new Set([...(prev.files ?? []), ...changedFiles])],
    } : prev)
  }

  function handleAddRepo(repoId: string) {
    if (!session) return
    const newIds = session.repoIds.includes(repoId) ? session.repoIds : [...session.repoIds, repoId]
    window.api.create.updateRepos(sessionId, newIds)
    setSession(prev => prev ? { ...prev, repoIds: newIds } : prev)
  }

  function handleRemoveRepo(repoId: string) {
    if (!session) return
    const newIds = session.repoIds.filter(id => id !== repoId)
    window.api.create.updateRepos(sessionId, newIds)
    setSession(prev => prev ? { ...prev, repoIds: newIds } : prev)
  }

  function handlePublished(url: string) {
    setSession(prev => prev ? { ...prev, publishStatus: 'published', githubRepoUrl: url, dirty: false, pendingChanges: [] } : prev)
  }

  function handlePushed() {
    setSession(prev => prev ? { ...prev, dirty: false, pendingChanges: [] } : prev)
  }

  if (!session) return <div className="create-canvas"><div style={{ padding: 40, color: 'var(--t4)' }}>Loading…</div></div>

  return (
    <div className="create-canvas">
      <div className="discover-drag-strip" aria-hidden="true" />
      <CreateMetaBar
        session={session}
        onNameChange={name => { window.api.create.updateName(sessionId, name); setSession(prev => prev ? { ...prev, name } : prev) }}
        onRemoveRepo={handleRemoveRepo}
        onPublished={handlePublished}
        onPushed={handlePushed}
      />
      {session.publishStatus === 'published' && (session.pendingChanges?.length ?? 0) > 0 && (
        <div className="create-diff-strip">
          {session.pendingChanges!.map(f => (
            <span key={f} className="create-diff-changed">~ {f}</span>
          ))}
        </div>
      )}
      <div className="create-panels">
        <RepoBrowser repoIds={session.repoIds} templateId={session.templateId} onAdd={handleAddRepo} onRemove={handleRemoveRepo} />
        <div className="create-preview-panel">
          <div className="create-preview-area">
            <PreviewAdapter session={session} />
            {inspectFile && (
              <div className="create-code-inspector">
                <div className="create-code-inspector-header">
                  <span className="create-code-inspector-title">{inspectFile}</span>
                  <button className="create-code-inspector-close" onClick={() => setInspectFile(null)}>✕</button>
                </div>
                <pre className="create-code-inspector-body">{inspectContent}</pre>
              </div>
            )}
          </div>
          <FileStrip files={session.files ?? []} onFileClick={handleFileClick} />
        </div>
        <AiChatPanel
          session={session}
          streamingToken={streamingToken}
          onMessageSent={handleMessageSent}
        />
      </div>
    </div>
  )
}
