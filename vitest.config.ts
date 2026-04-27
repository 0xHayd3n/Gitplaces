import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    exclude: ['**/.worktrees/**', '**/.claude/**', '**/node_modules/**', '**/.git/**'],
    clearMocks: true,
  },
  resolve: {
    alias: [
      { find: '@renderer', replacement: resolve('src') },
      // unplugin-icons is ESM-only and can't load in CJS vitest config — stub all ~icons/* imports
      { find: /^~icons\/.*/, replacement: resolve('src/test/iconStub.tsx') },
    ]
  }
})
