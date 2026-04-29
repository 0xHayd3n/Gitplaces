// electron/services/updateService.ts

// ── Pure helpers (tested) ──────────────────────────────────────────────────────

/** Returns true if the upstream release tag differs from what we last stored. */
export function isNewerRelease(upstream: string, stored: string | null): boolean {
  if (!stored) return true
  return upstream !== stored
}

/** Returns true if the upstream pushed_at timestamp is more recent than stored. */
export function isNewerPushedAt(upstream: string, stored: string | null): boolean {
  if (!stored) return true
  return new Date(upstream).getTime() > new Date(stored).getTime()
}
