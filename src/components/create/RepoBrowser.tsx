import { useState, useEffect } from 'react'
import type { LibrarySavedRepo } from '../../types/repo'

interface Props {
  repoIds: string[]
  templateId: string
  onAdd: (repoId: string) => void
  onRemove: (repoId: string) => void
}

export default function RepoBrowser({ repoIds, onAdd, onRemove }: Props) {
  const [libraryRepos, setLibraryRepos] = useState<LibrarySavedRepo[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    window.api.library.getAll().then(setLibraryRepos)
  }, [])

  const filtered = libraryRepos.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.owner.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="create-repo-panel">
      <div className="create-repo-panel-section">
        <span className="create-repo-panel-label">Your Library</span>
        <input className="create-repo-search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="create-repo-list">
        {filtered.slice(0, 20).map(r => {
          const id = `${r.owner}/${r.name}`
          const added = repoIds.includes(id)
          return (
            <div
              key={id}
              className={`create-repo-item${added ? ' added' : ''}`}
              onClick={() => added ? onRemove(id) : onAdd(id)}
            >
              <div>
                <div className="create-repo-item-name">{r.name}</div>
                <div className="create-repo-item-meta">★ {r.stars?.toLocaleString()} · {r.language}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
