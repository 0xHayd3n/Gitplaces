import { useState } from 'react'
import { Star, Download } from 'lucide-react'
import type { SavedRepo } from '../types/repo'

interface Props {
  row: SavedRepo
  onInstalled: () => void
}

export default function NotInstalledDetail({ row, onInstalled }: Props) {
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleInstall() {
    setInstalling(true)
    setError(null)
    try {
      await window.api.skill.generate(row.owner, row.name, { flavour: 'library' })
      onInstalled()
    } catch {
      setError('Failed to install skill. Check your connection and try again.')
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="not-installed-detail">
      <div className="not-installed-hero">
        {row.ownerAvatarUrl && (
          <img src={row.ownerAvatarUrl} alt="" className="not-installed-avatar" />
        )}
        <div className="not-installed-titles">
          <h2 className="not-installed-name">{row.name}</h2>
          <span className="not-installed-owner">{row.owner}</span>
        </div>
        <span className="not-installed-starred-badge">
          <Star size={11} fill="currentColor" />
          Starred
        </span>
      </div>

      {row.description && (
        <p className="not-installed-desc">{row.description}</p>
      )}

      <div className="not-installed-meta">
        {row.stars != null && (
          <span className="not-installed-stat">
            <Star size={11} />
            {row.stars.toLocaleString()}
          </span>
        )}
        {row.language && (
          <span className="not-installed-stat">{row.language}</span>
        )}
      </div>

      <div className="not-installed-install-zone">
        <p className="not-installed-hint">
          This repo is starred but no skill has been generated yet.
          Install it to make it available in Claude Code.
        </p>
        {error && <p className="not-installed-error">{error}</p>}
        <button
          className="not-installed-btn"
          onClick={handleInstall}
          disabled={installing}
        >
          <Download size={14} />
          {installing ? 'Installing…' : 'Install Skill'}
        </button>
      </div>
    </div>
  )
}
