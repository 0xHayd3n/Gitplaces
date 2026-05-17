import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AnatomyView from './AnatomyView'
import type { AnatomyPayload } from '../types/repo'

const payload: AnatomyPayload = {
  source: 'generated', commit: 'c1', fingerprint: 'fp', rawContent: '[identity]\nstack="ts"\n',
  rawMemory: null,
  model: {
    identity: { stack: 'ts', form: 'library', domain: 'tooling', function: 'demo' },
    generated: {},
    rules: [{ statement: 'no console.log', verify: { kind: 'glob' } }],
    decisions: [{ decision: 'serve verbatim', rationale: 'fidelity' }],
  },
  memory: [], verify: null,
}

describe('AnatomyView', () => {
  it('renders identity pillars and verbatim rules/decisions', () => {
    render(<AnatomyView payload={payload} />)
    expect(screen.getByText('library')).toBeInTheDocument()
    expect(screen.getByText('no console.log')).toBeInTheDocument()
    expect(screen.getByText(/serve verbatim/)).toBeInTheDocument()
    expect(screen.getByText(/fidelity/)).toBeInTheDocument()
  })

  it('toggles raw .anatomy view', () => {
    render(<AnatomyView payload={payload} />)
    expect(screen.queryByText(/\[identity\]/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /view raw/i }))
    expect(screen.getByText(/\[identity\]/)).toBeInTheDocument()
  })

  it('falls back to raw when model is null (malformed)', () => {
    render(<AnatomyView payload={{ ...payload, model: null }} />)
    expect(screen.getByText(/\[identity\]/)).toBeInTheDocument()
  })
})
