// Pure helpers for the Claude login flow. Extracted from legacy.ts so they
// can be unit-tested without the PTY / IPC surface.

/**
 * Strip ANSI escape sequences from PTY output.
 * Covers CSI (color, cursor, formatting) and OSC (terminal title, hyperlinks).
 */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // OSC sequences split across PTY chunks are left verbatim — acceptable for display-only.
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
}

/**
 * True if the CLI fell back to manual-paste mode. We detect this by the
 * fallback URL it prints and hard-fail rather than re-introducing a paste UI.
 */
export function detectManualFallback(cleanOutput: string): boolean {
  return cleanOutput.includes('platform.claude.com/oauth/code/callback')
}
