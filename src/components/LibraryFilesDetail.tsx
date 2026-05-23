import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { RepoNavProvider } from '../contexts/RepoNav'
import FilesTab from './FilesTab'
import Toggle from './Toggle'
import { getLangConfig } from './BannerSVG'
import type { LibraryRow } from '../types/repo'

interface Props {
  row: LibraryRow
  onToggleActive: (v: boolean) => void
  onInstalled: (result: { content: string; version: string | null; generated_at: string | null }) => void
}

export default function LibraryFilesDetail({ row, onToggleActive, onInstalled }: Props) {
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const navigate = useNavigate()
  const cfg = getLangConfig(row.language ?? '')

  async function handleInstall() {
    setInstalling(true)
    setInstallError(null)
    try {
      const result = await window.api.skill.generate(row.owner, row.name, { flavour: 'library' })
      if ('cancelled' in result) {
        return
      }
      onInstalled({ content: result.content ?? '', version: result.version, generated_at: result.generated_at })
    } catch {
      setInstallError('Install failed')
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="library-files-detail">
      <div className="lib-files-header">
        <div className="lib-files-lang" style={{ background: cfg.bg, color: cfg.primary }}>
          {cfg.abbr}
        </div>
        <div className="lib-files-title">{row.name}</div>
        <div className="lib-files-owner">by {row.owner}</div>
        {row.stars != null && (
          <div className="lib-files-meta">⭐ {row.stars.toLocaleString()}</div>
        )}
        {row.version && (
          <div className="lib-files-meta">{row.version}</div>
        )}
        <div className="lib-files-actions">
          <button
            className="lib-btn-view-repo"
            onClick={() => navigate(`/repo/${row.owner}/${row.name}`)}
            title="View repo"
          >
            <ExternalLink size={12} />
          </button>
          {row.installed === 0 ? (
            <button
              className="lib-files-install-btn"
              onClick={handleInstall}
              disabled={installing}
            >
              {installing ? 'Installing…' : 'Install'}
            </button>
          ) : (
            <Toggle on={row.active === 1} onChange={onToggleActive} ariaLabel="Toggle skill active" />
          )}
        </div>
      </div>

      {installError && (
        <div className="lib-files-install-error">{installError}</div>
      )}

      <div className="lib-files-body">
        <RepoNavProvider>
          <FilesTab
            owner={row.owner}
            name={row.name}
            branch={row.default_branch ?? 'main'}
          />
        </RepoNavProvider>
      </div>
    </div>
  )
}
