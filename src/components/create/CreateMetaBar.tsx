import { useState } from 'react'
import type { CreateSession } from '../../types/create'

const TYPE_LABELS: Record<string, string> = { mcp: 'MCP Server', webapp: 'Web App', cli: 'CLI Tool', widget: 'Desktop', blank: 'Custom' }

interface Props {
  session: CreateSession & { dirty?: boolean; pendingChanges?: string[] }
  onNameChange: (name: string) => void
  onRemoveRepo: (repoId: string) => void
  onPublished: (url: string) => void
  onPushed: () => void
}

export default function CreateMetaBar({ session, onNameChange, onRemoveRepo, onPublished, onPushed }: Props) {
  const [publishing, setPublishing] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [repoName] = useState(session.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'))

  async function handlePublish() {
    setPublishing(true)
    try {
      const result = await (window.api.create as any).publishToGitHub({
        sessionId: session.id,
        repoName,
        description: 'Built with Gitplaces Create',
        isPrivate: false,
        localPath: session.localPath!,
      }) as { githubRepoUrl: string }
      onPublished(result.githubRepoUrl)
    } catch (e: unknown) {
      const err = e as { message?: string }
      if (err.message === 'SCOPE_MISSING') {
        alert('GitHub permission needed. Please disconnect GitHub in Settings and reconnect to grant repo creation access.')
      }
    } finally {
      setPublishing(false)
    }
  }

  async function handlePush() {
    setPushing(true)
    try {
      await (window.api.create as any).pushUpdate({ sessionId: session.id, localPath: session.localPath!, githubRepoUrl: session.githubRepoUrl! })
      onPushed()
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="create-meta-bar">
      <input
        className="create-meta-name"
        value={session.name}
        onChange={e => onNameChange(e.target.value)}
      />
      <span className="create-type-badge">{TYPE_LABELS[session.toolType] ?? session.toolType}</span>
      <div className="create-repo-chips">
        {session.repoIds.map(id => (
          <span key={id} className="create-repo-chip">
            {id.split('/')[1] ?? id}
            <button className="create-repo-chip-remove" onClick={() => onRemoveRepo(id)}>×</button>
          </span>
        ))}
      </div>
      <div className="create-meta-right">
        {session.publishStatus === 'draft' ? (
          <>
            <span className="create-draft-pill">● Draft</span>
            <button className="create-publish-btn" onClick={handlePublish} disabled={publishing}>
              {publishing ? 'Publishing…' : 'Publish ↗'}
            </button>
          </>
        ) : (
          <>
            <span className="create-published-pill">
              ✓ Published
              {(session.pendingChanges?.length ?? 0) > 0 && (
                <span className="create-changes-badge">{session.pendingChanges!.length} changes</span>
              )}
              <span className="create-published-link" onClick={() => window.api.openExternal(session.githubRepoUrl!)}>
                {session.githubRepoUrl?.replace('https://github.com/', '')} ↗
              </span>
            </span>
            <button className="create-push-btn" onClick={handlePush} disabled={pushing || !session.dirty}>
              {pushing ? 'Pushing…' : 'Push Update ↑'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
