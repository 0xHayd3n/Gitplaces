// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { scoreScale } from './scaleSignal'

describe('scoreScale', () => {
  it('exact match → 1.0', () => {
    expect(scoreScale(100, 100)).toBeCloseTo(1, 2)
  })
  it('above median: capped at 0.5 floor', () => {
    expect(scoreScale(10_000_000, 100)).toBeGreaterThanOrEqual(0.5)
  })
  it('below median: gem floor of 0.4', () => {
    expect(scoreScale(50, 50_000)).toBeGreaterThanOrEqual(0.4)
  })
  it('zero median treats candidate stars as ratio anchor', () => {
    // log10(0+1)=0; with median=0, identical → 1.0
    expect(scoreScale(0, 0)).toBeCloseTo(1, 2)
  })
  it('1 order of magnitude above median', () => {
    // log10(1001) - log10(101) ≈ 0.997
    // score above: 1 - 0.997/2 ≈ 0.50; floor kicks in
    expect(scoreScale(1000, 100)).toBeGreaterThanOrEqual(0.5)
  })
  it('1 order of magnitude below median', () => {
    // log10(11) ≈ 1.041, log10(101) ≈ 2.004; delta ≈ 0.963
    // score = max(0.4, 1 - 0.963/3) ≈ 0.679
    expect(scoreScale(10, 100)).toBeCloseTo(0.679, 2)
  })
})
