// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AgentEmojiPicker from './AgentEmojiPicker'

describe('AgentEmojiPicker', () => {
  it('renders the current emoji on the trigger button', () => {
    render(<AgentEmojiPicker value="🔍" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /emoji/i }).textContent).toContain('🔍')
  })

  it('shows a default glyph when value is null', () => {
    render(<AgentEmojiPicker value={null} onChange={() => {}} />)
    const btn = screen.getByRole('button', { name: /emoji/i })
    expect(btn.textContent?.length ?? 0).toBeGreaterThan(0)
  })

  it('opens the popover on click and shows emoji choices', () => {
    render(<AgentEmojiPicker value={null} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /emoji/i }))
    // popover renders multiple emoji buttons; at least one should be a known curated entry
    const allButtons = screen.getAllByRole('button')
    const emojiButtons = allButtons.filter(b => b.getAttribute('data-emoji'))
    expect(emojiButtons.length).toBeGreaterThan(50)
  })

  it('emits onChange with the selected emoji', () => {
    const onChange = vi.fn()
    render(<AgentEmojiPicker value={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /emoji/i }))
    const target = screen.getAllByRole('button').find(b => b.getAttribute('data-emoji') === '🔍')!
    fireEvent.click(target)
    expect(onChange).toHaveBeenCalledWith('🔍')
  })

  it('filters by search input', () => {
    render(<AgentEmojiPicker value={null} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /emoji/i }))
    const search = screen.getByPlaceholderText(/search/i) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'search' } })
    const matches = screen.getAllByRole('button').filter(b => b.getAttribute('data-emoji'))
    // 🔍 has the keyword "search"; we expect at least it to remain
    expect(matches.some(b => b.getAttribute('data-emoji') === '🔍')).toBe(true)
  })
})
