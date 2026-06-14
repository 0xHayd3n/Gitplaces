// src/lib/hostIds.ts
//
// Renderer-side mirror of the canonical host-id constants. The main process
// owns these in electron/providers/types.ts; this file exists so the renderer
// can use them as runtime values without import-pulling the electron module.

export const HOST_ID_GITHUB = 'gh:api.github.com'
