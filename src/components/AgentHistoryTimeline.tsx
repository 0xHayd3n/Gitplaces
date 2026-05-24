import { useMemo, useState } from 'react'
import type { AgentRevision } from '../types/agent'
import { DateDivider } from './DateDivider'

interface Props {
  revisions: AgentRevision[]
  onRestore: (revisionId: string) => void
}

function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const dayStart = new Date(d)
  dayStart.setHours(0, 0, 0, 0)
  if (dayStart.getTime() === today.getTime()) return 'Today'
  if (dayStart.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function groupByDay(revisions: AgentRevision[], now: Date): Array<{ label: string; items: AgentRevision[] }> {
  const groups: Array<{ label: string; items: AgentRevision[] }> = []
  for (const rev of revisions) {
    const label = dayLabel(rev.created_at, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(rev)
    else groups.push({ label, items: [rev] })
  }
  return groups
}

export default function AgentHistoryTimeline({ revisions, onRestore }: Props) {
  const [openDiffId, setOpenDiffId] = useState<string | null>(null)
  const now = useMemo(() => new Date(), [revisions])
  const groups = useMemo(() => groupByDay(revisions, now), [revisions, now])

  if (revisions.length === 0) {
    return (
      <div className="agent-history-empty">
        No history yet. Edits to the body or presets will appear here.
      </div>
    )
  }

  return (
    <div className="agent-history">
      {groups.map(group => (
        <div key={group.label} className="agent-history-group">
          <DateDivider label={group.label} />
          {group.items.map(rev => {
            const absoluteIndex = revisions.indexOf(rev)
            const prior = revisions[absoluteIndex + 1] ?? null
            const isCurrent = absoluteIndex === 0
            const canDiff = rev.kind === 'body_edit' && prior !== null
            const isDiffOpen = openDiffId === rev.id
            return (
              <div key={rev.id} className="agent-history-row">
                <span className="agent-history-time">{timeLabel(rev.created_at)}</span>
                <span
                  className={`agent-history-dot agent-history-dot--${rev.kind}`}
                  aria-hidden="true"
                />
                <span className="agent-history-summary">{rev.summary}</span>
                <span className="agent-history-actions">
                  {canDiff && (
                    <button
                      type="button"
                      className="agent-history-btn"
                      onClick={() => setOpenDiffId(isDiffOpen ? null : rev.id)}
                    >
                      {isDiffOpen ? 'Close diff' : 'Diff'}
                    </button>
                  )}
                  {!isCurrent && (
                    <button
                      type="button"
                      className="agent-history-btn"
                      onClick={() => onRestore(rev.id)}
                    >
                      Restore
                    </button>
                  )}
                </span>
                {canDiff && isDiffOpen && prior !== null && (
                  <div className="agent-history-diff">
                    <pre className="agent-history-diff-pane agent-history-diff-pane--old">
                      {prior.body}
                    </pre>
                    <pre className="agent-history-diff-pane agent-history-diff-pane--new">
                      {rev.body}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
