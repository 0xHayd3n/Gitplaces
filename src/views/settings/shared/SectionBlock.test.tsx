import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import SectionBlock from './SectionBlock'

describe('SectionBlock', () => {
  it('renders the title in uppercase track', () => {
    render(
      <SectionBlock title="API / HTTPS">
        <div>body</div>
      </SectionBlock>,
    )
    expect(screen.getByText('API / HTTPS')).toBeInTheDocument()
  })

  it('renders the count pill when count is provided', () => {
    render(
      <SectionBlock title="API / HTTPS" count={4}>
        <div>body</div>
      </SectionBlock>,
    )
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('renders BETA badge when badge="BETA"', () => {
    render(
      <SectionBlock title="Custom MCP" badge="BETA">
        <div>body</div>
      </SectionBlock>,
    )
    expect(screen.getByText('BETA')).toBeInTheDocument()
  })

  it('renders body by default (defaultExpanded defaults to true)', () => {
    render(
      <SectionBlock title="API / HTTPS">
        <div data-testid="body">body content</div>
      </SectionBlock>,
    )
    expect(screen.getByTestId('body')).toBeInTheDocument()
  })

  it('does NOT render body when defaultExpanded is false', () => {
    render(
      <SectionBlock title="MCP" defaultExpanded={false}>
        <div data-testid="body">body content</div>
      </SectionBlock>,
    )
    expect(screen.queryByTestId('body')).not.toBeInTheDocument()
  })

  it('toggles body visibility when header is clicked', () => {
    render(
      <SectionBlock title="MCP" defaultExpanded={false}>
        <div data-testid="body">body content</div>
      </SectionBlock>,
    )
    expect(screen.queryByTestId('body')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('MCP'))
    expect(screen.getByTestId('body')).toBeInTheDocument()
    fireEvent.click(screen.getByText('MCP'))
    expect(screen.queryByTestId('body')).not.toBeInTheDocument()
  })
})
