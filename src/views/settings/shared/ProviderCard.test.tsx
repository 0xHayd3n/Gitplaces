import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ProviderCard from './ProviderCard'

describe('ProviderCard', () => {
  it('renders the icon, name, chip and description', () => {
    render(
      <ProviderCard
        icon={<span data-testid="icon">I</span>}
        name="Anthropic"
        chip="API"
        description="Claude Opus, Sonnet, Haiku."
      />,
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('API')).toBeInTheDocument()
    expect(screen.getByText('Claude Opus, Sonnet, Haiku.')).toBeInTheDocument()
  })

  it('renders the status text with the correct tone class', () => {
    const { container } = render(
      <ProviderCard
        icon={<span>I</span>}
        name="Anthropic"
        chip="API"
        description="desc"
        status={{ tone: 'green', text: 'Connected' }}
      />,
    )
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(container.querySelector('.status-dot.green')).toBeTruthy()
  })

  it('renders children (e.g. an input) inside the card', () => {
    render(
      <ProviderCard
        icon={<span>I</span>}
        name="Anthropic"
        chip="API"
        description="desc"
      >
        <input data-testid="api-key-input" />
      </ProviderCard>,
    )
    expect(screen.getByTestId('api-key-input')).toBeInTheDocument()
  })

  it('renders actions when provided', () => {
    render(
      <ProviderCard
        icon={<span>I</span>}
        name="Anthropic"
        chip="API"
        description="desc"
        actions={<button>Test</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument()
  })

  it('applies the correct chip class for CLI', () => {
    const { container } = render(
      <ProviderCard
        icon={<span>I</span>}
        name="OpenCode"
        chip="CLI"
        description="desc"
      />,
    )
    expect(container.querySelector('.transport-chip.cli')).toBeTruthy()
  })
})
