import { describe, it, expect } from 'vitest'
import { detectFramework, detectFrameworkFromTree, isComponentFile } from './componentScanner'

describe('detectFramework', () => {
  it('detects react', () => {
    expect(detectFramework({ react: '^18.0.0' })).toBe('react')
  })
  it('detects react via react-dom', () => {
    expect(detectFramework({ 'react-dom': '^18.0.0' })).toBe('react')
  })
  it('detects vue', () => {
    expect(detectFramework({ vue: '^3.0.0' })).toBe('vue')
  })
  it('detects svelte', () => {
    expect(detectFramework({ svelte: '^4.0.0' })).toBe('svelte')
  })
  it('detects solid before react', () => {
    expect(detectFramework({ 'solid-js': '^1.0.0', react: '^18.0.0' })).toBe('solid')
  })
  it('detects angular first when multiple present', () => {
    expect(detectFramework({ '@angular/core': '^17.0.0', react: '^18.0.0' })).toBe('angular')
  })
  it('returns unknown when nothing matches', () => {
    expect(detectFramework({ lodash: '^4.0.0' })).toBe('unknown')
  })
  it('returns unknown for empty deps', () => {
    expect(detectFramework({})).toBe('unknown')
  })
})

describe('detectFrameworkFromTree', () => {
  it('detects vue from .vue files', () => {
    expect(detectFrameworkFromTree(['src/Button.vue', 'src/Input.vue'])).toBe('vue')
  })
  it('detects svelte from .svelte files', () => {
    expect(detectFrameworkFromTree(['src/App.svelte'])).toBe('svelte')
  })
  it('detects react from .tsx files', () => {
    expect(detectFrameworkFromTree(['src/Button.tsx'])).toBe('react')
  })
  it('detects react from .jsx files', () => {
    expect(detectFrameworkFromTree(['src/Button.jsx'])).toBe('react')
  })
  it('returns javascript for plain .js-only repos (jQuery/vanilla)', () => {
    expect(detectFrameworkFromTree(['src/definitions/modules/accordion.js'])).toBe('javascript')
  })
  it('returns typescript for .ts-only repos', () => {
    expect(detectFrameworkFromTree(['src/components/Button.ts', 'src/utils/helpers.ts'])).toBe('typescript')
  })
  it('returns unknown for no matching files', () => {
    expect(detectFrameworkFromTree(['README.md', 'package.json'])).toBe('unknown')
  })
  it('detects angular from .component.ts files', () => {
    expect(detectFrameworkFromTree(['src/app/app.component.ts', 'src/app/app.module.ts'])).toBe('angular')
  })
  it('detects react (not solid) for repos with only .tsx files — known Solid/React collision', () => {
    // Solid also uses .tsx; without package.json info, tree detection returns 'react'
    expect(detectFrameworkFromTree(['src/components/Button.tsx'])).toBe('react')
  })
})

describe('isComponentFile', () => {
  it('accepts a .tsx file in /components/', () => {
    expect(isComponentFile('src/components/Button.tsx', 'react')).toBe(true)
  })
  it('accepts a .vue file in /components/', () => {
    expect(isComponentFile('src/components/Input.vue', 'vue')).toBe(true)
  })
  it('accepts a .svelte file in /ui/', () => {
    expect(isComponentFile('src/ui/Badge.svelte', 'svelte')).toBe(true)
  })
  it('accepts a PascalCase .tsx at src/ root', () => {
    expect(isComponentFile('src/Button.tsx', 'react')).toBe(true)
  })
  it('accepts a file in packages/*/src/', () => {
    expect(isComponentFile('packages/core/src/components/Modal.tsx', 'react')).toBe(true)
  })
  it('rejects monorepo file outside include directories', () => {
    expect(isComponentFile('packages/core/src/stores/AuthStore.tsx', 'react')).toBe(false)
  })
  it('accepts a Radix-style package-entry file (lowercase, name matches dir)', () => {
    // packages/react/dialog/src/dialog.tsx — radix-ui/primitives style
    expect(isComponentFile('packages/react/dialog/src/dialog.tsx', 'react')).toBe(true)
  })
  it('accepts package-entry under deeply nested scope (@mantine/core/src/core.tsx)', () => {
    expect(isComponentFile('packages/@mantine/core/src/core.tsx', 'react')).toBe(true)
  })
  it('rejects package-entry-shaped file when name does not match parent dir', () => {
    // packages/react/dialog/src/utils.ts — utility, not the package main
    expect(isComponentFile('packages/react/dialog/src/utils.ts', 'react')).toBe(false)
  })
  it('accepts /components/ files in nested monorepos', () => {
    expect(isComponentFile('packages/@mantine/core/src/components/Button/Button.tsx', 'react')).toBe(true)
  })
  it('rejects a test file', () => {
    expect(isComponentFile('src/components/Button.test.tsx', 'react')).toBe(false)
  })
  it('rejects a stories file', () => {
    expect(isComponentFile('src/components/Button.stories.tsx', 'react')).toBe(false)
  })
  it('rejects index files', () => {
    expect(isComponentFile('src/components/index.ts', 'react')).toBe(false)
  })
  it('rejects hook files (use* pattern)', () => {
    expect(isComponentFile('src/components/useButton.tsx', 'react')).toBe(false)
  })
  it('rejects kebab-case hook files (use-* pattern, Radix style)', () => {
    expect(isComponentFile('packages/react/use-callback-ref/src/use-callback-ref.tsx', 'react')).toBe(false)
  })
  it('rejects kebab-case hooks even when in /components/', () => {
    expect(isComponentFile('src/components/use-controllable-state.tsx', 'react')).toBe(false)
  })
  it('accepts a lowercase .tsx file in /ui/ (shadcn/ui style)', () => {
    expect(isComponentFile('apps/www/registry/default/ui/button.tsx', 'react')).toBe(true)
  })
  it('accepts a lowercase .tsx file in /components/', () => {
    expect(isComponentFile('src/components/button.tsx', 'react')).toBe(true)
  })
  it('rejects a lowercase file outside any include directory', () => {
    expect(isComponentFile('src/utils/helpers.tsx', 'react')).toBe(false)
  })
  it('rejects files in dist/', () => {
    expect(isComponentFile('dist/components/Button.tsx', 'react')).toBe(false)
  })
  it('rejects build scripts in tasks/components/', () => {
    expect(isComponentFile('tasks/components/create.js', 'unknown')).toBe(false)
  })
  it('rejects files in scripts/', () => {
    expect(isComponentFile('scripts/components/setup.js', 'unknown')).toBe(false)
  })
  it('rejects files with wrong extension for framework', () => {
    expect(isComponentFile('src/components/Button.vue', 'react')).toBe(false)
  })
  it('rejects .d.ts files', () => {
    expect(isComponentFile('src/components/Button.d.ts', 'react')).toBe(false)
  })
  it('accepts .ts files for unknown framework (unknown is permissive)', () => {
    expect(isComponentFile('src/components/MyService.ts', 'unknown')).toBe(true)
  })
  it('rejects .ts files outside include dirs for unknown framework', () => {
    expect(isComponentFile('src/utils/MyService.ts', 'unknown')).toBe(false)
  })
  it('accepts a .js component in /components/ for react', () => {
    expect(isComponentFile('src/components/Button.js', 'react')).toBe(true)
  })
  it('accepts a .js component in /components/ for unknown framework', () => {
    expect(isComponentFile('src/components/Button.js', 'unknown')).toBe(true)
  })
  it('accepts a lowercase .js component in /ui/ for unknown framework', () => {
    expect(isComponentFile('src/ui/button.js', 'unknown')).toBe(true)
  })
  it('accepts Semantic-UI-style .js files in /modules/', () => {
    expect(isComponentFile('src/definitions/modules/accordion.js', 'javascript')).toBe(true)
  })
  it('accepts Semantic-UI-style .js files in /modules/ (modal)', () => {
    expect(isComponentFile('src/definitions/modules/modal.js', 'javascript')).toBe(true)
  })
})
