// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AgentColorPicker, { type AgentColorPickerProps } from './AgentColorPicker'

function setup(overrides: Partial<AgentColorPickerProps> = {}) {
  const onChange = vi.fn()
  const props: AgentColorPickerProps = {
    mode: 'solid',
    colorStart: '#6366f1',
    colorEnd: null,
    harmony: 'manual',
    onChange,
    ...overrides,
  }
  render(<AgentColorPicker {...props} />)
  return { onChange }
}

describe('AgentColorPicker', () => {
  it('renders Solid/Gradient toggle with Solid active by default', () => {
    setup()
    const solid = screen.getByRole('button', { name: /solid/i })
    const gradient = screen.getByRole('button', { name: /gradient/i })
    expect(solid.getAttribute('aria-pressed')).toBe('true')
    expect(gradient.getAttribute('aria-pressed')).toBe('false')
  })

  it('shows only one hex input in solid mode', () => {
    setup()
    expect(screen.getAllByLabelText(/hex/i).length).toBe(1)
  })

  it('switching to gradient calls onChange with mode=gradient and a generated colorEnd', () => {
    const { onChange } = setup({ mode: 'solid' })
    fireEvent.click(screen.getByRole('button', { name: /gradient/i }))
    expect(onChange).toHaveBeenCalled()
    const arg = onChange.mock.calls.at(-1)?.[0]
    expect(arg.mode).toBe('gradient')
    expect(arg.colorEnd).toMatch(/^#[0-9a-f]{6}$/i)
    expect(arg.harmony).toBe('complementary')
  })

  it('in gradient mode, picking a harmony updates colorEnd', () => {
    const { onChange } = setup({ mode: 'gradient', colorStart: '#6366f1', colorEnd: '#a855f7', harmony: 'complementary' })
    fireEvent.click(screen.getByRole('button', { name: /triadic/i }))
    expect(onChange).toHaveBeenCalled()
    const arg = onChange.mock.calls.at(-1)?.[0]
    expect(arg.harmony).toBe('triadic')
    // the new colorEnd should differ from the previous "complementary" colorEnd
    expect(arg.colorEnd?.toLowerCase()).not.toBe('#a855f7')
  })

  it('manual harmony lets the end color picker move independently', () => {
    const { onChange } = setup({ mode: 'gradient', colorStart: '#6366f1', colorEnd: '#a855f7', harmony: 'manual' })
    const endInput = screen.getAllByLabelText(/hex/i)[1] as HTMLInputElement
    fireEvent.change(endInput, { target: { value: '#00ff00' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ colorEnd: '#00ff00' }))
  })

  it('typing in the start hex input updates colorStart', () => {
    const { onChange } = setup({ mode: 'solid' })
    const startInput = screen.getAllByLabelText(/hex/i)[0] as HTMLInputElement
    fireEvent.change(startInput, { target: { value: '#ff0000' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ colorStart: '#ff0000' }))
  })
})
