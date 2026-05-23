import { formatElapsed } from '../hooks/useLearningProgress'
import type { LearningPhase, LearningTerminalState } from '../contexts/LearningProgressContext'

interface Props {
  phase: LearningPhase | LearningTerminalState
  percent: number
  elapsedMs: number
  state: 'running' | LearningTerminalState
  error?: string
}

const PHASE_LABEL: Record<LearningPhase | LearningTerminalState, string> = {
  cloning: 'LEARNING',
  validating: 'LEARNING',
  generating: 'LEARNING',
  verifying: 'LEARNING',
  persisting: 'LEARNING',
  completed: 'LEARNED',
  cancelled: 'CANCELLED',
  failed: 'FAILED',
}

export function LearnStatusInline({ phase, percent, elapsedMs, state, error }: Props) {
  const label = PHASE_LABEL[phase]
  const isFailed = state === 'failed'
  return (
    <div className={`learn-status-inline${isFailed ? ' learn-status-inline--failed' : ''}`} title={error}>
      <div className="learn-status-label">{label}</div>
      <div className="learn-status-meta">
        {state === 'running' ? `${percent}% Complete` : (isFailed ? (error ?? 'Error') : 'Done')}
        <span className="learn-status-meta-sep"> · </span>
        <span className="learn-status-meta-elapsed">{formatElapsed(elapsedMs)}</span>
      </div>
      <div className="learn-status-bar">
        <div className="learn-status-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
