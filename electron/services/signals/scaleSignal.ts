// electron/services/signals/scaleSignal.ts

export function scoreScale(candidateStars: number, medianStars: number): number {
  const candidateLog = Math.log10(candidateStars + 1)
  const medianLog    = Math.log10(medianStars + 1)
  if (candidateLog >= medianLog) {
    return Math.max(0.5, 1 - (candidateLog - medianLog) / 2)
  }
  return Math.max(0.4, 1 - (medianLog - candidateLog) / 3)
}
