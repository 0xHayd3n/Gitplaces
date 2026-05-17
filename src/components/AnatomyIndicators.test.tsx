import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AnatomyIndicators from './AnatomyIndicators'
import type { AnatomyPayload } from '../types/repo'

const base: AnatomyPayload = {
  source: 'committed', commit: 'abc1234', fingerprint: 'fp1', rawContent: '', rawMemory: null,
  model: { identity: {}, generated: { fingerprint: 'fp1' }, rules: [{ statement: 'r1' }, { statement: 'r2' }],
           decisions: [{ decision: 'd1' }] },
  memory: [{ text: 'm1' }],
  verify: { ok: true, errors: [], warnings: [], rules: [], skipped: [] },
}

describe('AnatomyIndicators', () => {
  it('shows source badge, counts, and fresh state', () => {
    render(<AnatomyIndicators payload={base} updateAvailable={0} />)
    expect(screen.getByText(/committed/i)).toBeInTheDocument()
    expect(screen.getByText(/2 rules/i)).toBeInTheDocument()
    expect(screen.getByText(/1 decision/i)).toBeInTheDocument()
    expect(screen.getByText(/1 memory/i)).toBeInTheDocument()
    expect(screen.getByText(/fresh/i)).toBeInTheDocument()
  })

  it('shows stale when updateAvailable=1', () => {
    render(<AnatomyIndicators payload={base} updateAvailable={1} />)
    expect(screen.getByText(/stale/i)).toBeInTheDocument()
  })

  it('flags fingerprint mismatch', () => {
    const p = { ...base, model: { ...base.model!, generated: { fingerprint: 'DIFFERENT' } }, fingerprint: 'fp1', rawMemory: 'x' }
    render(<AnatomyIndicators payload={p} updateAvailable={0} />)
    expect(screen.getByText(/memory may be stale/i)).toBeInTheDocument()
  })
})
