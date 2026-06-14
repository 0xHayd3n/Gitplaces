// electron/services/deviceFlowState.ts
//
// Shared, module-level AbortController slot for the GitHub device-flow poll.
//
// During Phase 3 of the multi-host migration, both the legacy `github:*` IPC
// handlers (in electron/main.ts) and the new `hosts:*` IPC handlers (in
// electron/ipc/hostHandlers.ts) coexist. Only one device flow can be active at
// a time, so they need to share the same abort signal — otherwise starting via
// one handler and cancelling via the other would leave the original poll
// dangling. This tiny module owns that shared slot so neither file owns it
// directly. Task 13 removes the legacy handler and this module reduces to the
// new namespace's local state.
//
// Not thread-safe by design: Electron's main process is single-threaded, and
// only one device flow can be in progress at a time across all hosts.
let deviceFlowAbort: AbortController | null = null

export function getDeviceFlowAbort(): AbortController | null {
  return deviceFlowAbort
}

export function setDeviceFlowAbort(controller: AbortController | null): void {
  deviceFlowAbort = controller
}
