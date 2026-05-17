import { useState } from 'react'
import type { AnatomyMemoryEntryView } from '../types/repo'

function ts(at?: string): number { return at ? new Date(at).getTime() || 0 : 0 }

export default function AnatomyMemoryPanel({ entries }: { entries: AnatomyMemoryEntryView[] }) {
  const [showSuperseded, setShowSuperseded] = useState(false)
  if (entries.length === 0) return null

  const sorted = [...entries].sort((a, b) => ts(b.at) - ts(a.at))
  const active = sorted.filter(e => !e.superseded)
  const superseded = sorted.filter(e => e.superseded)

  const Entry = ({ e, dim }: { e: AnatomyMemoryEntryView; dim?: boolean }) => (
    <li data-testid="anatomy-mem-entry" className={`anatomy-mem-entry${dim ? ' is-superseded' : ''}`}>
      <div className="anatomy-mem-meta">
        {e.kind && <span className="anatomy-mem-kind">{e.kind}</span>}
        {e.at && <span className="anatomy-mem-date">{e.at.slice(0, 10)}</span>}
        {e.last_verified_at && <span className="anatomy-mem-verified">verified {e.last_verified_at.slice(0, 10)}</span>}
      </div>
      <div className="anatomy-mem-text">{e.text}</div>
    </li>
  )

  return (
    <section className="anatomy-memory-panel">
      <h4>Lived experience</h4>
      <ul>{active.map((e, i) => <Entry key={i} e={e} />)}</ul>
      {superseded.length > 0 && (
        <>
          <button className="anatomy-mem-toggle" onClick={() => setShowSuperseded(s => !s)}>
            {showSuperseded ? 'Hide' : 'Show'} {superseded.length} superseded
          </button>
          {showSuperseded && <ul>{superseded.map((e, i) => <Entry key={i} e={e} dim />)}</ul>}
        </>
      )}
    </section>
  )
}
