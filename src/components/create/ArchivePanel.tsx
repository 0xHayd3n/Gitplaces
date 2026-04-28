import { useNavigate } from 'react-router-dom'
import type { ProjectEntry } from './TemplateGallery'

interface Props {
  archivedSet: Set<string>
  allEntries: ProjectEntry[]
}

export default function ArchivePanel({ archivedSet, allEntries }: Props) {
  const navigate = useNavigate()
  const archiveKeys = [...archivedSet]

  return (
    <div className="projects-panel">
      <div className="projects-panel-header">Archive</div>
      <div className="projects-panel-list">
        {archiveKeys.length === 0 ? (
          <div className="projects-panel-empty">No archived repos</div>
        ) : (
          archiveKeys.map(key => {
            const [owner, ...rest] = key.split('/')
            const name = rest.join('/')
            const entry = allEntries.find(e => `${e.row.owner}/${e.row.name}` === key)

            if (!entry) {
              return (
                <button key={key} type="button" className="projects-panel-item" disabled>
                  <span className="projects-panel-avatar-fallback">
                    {(name[0] ?? '?').toUpperCase()}
                  </span>
                  <span className="projects-panel-name">{name}</span>
                </button>
              )
            }

            const { row, hasGithub, localPath, isGitRepo } = entry
            const path = !hasGithub && localPath
              ? `/local-project?path=${encodeURIComponent(localPath)}&name=${encodeURIComponent(row.name)}&git=${isGitRepo ? '1' : '0'}`
              : `/repo/${row.owner}/${row.name}`

            return (
              <button
                key={key}
                type="button"
                className="projects-panel-item"
                onClick={() => navigate(path)}
              >
                {row.avatar_url ? (
                  <img src={row.avatar_url} alt="" className="projects-panel-avatar" />
                ) : (
                  <span className="projects-panel-avatar-fallback">
                    {(row.name[0] ?? '?').toUpperCase()}
                  </span>
                )}
                <span className="projects-panel-name">{row.name}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
