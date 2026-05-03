// src/utils/componentScanner.ts
import type { Framework } from '../types/components'

const FRAMEWORK_PACKAGES: [string, Framework][] = [
  ['@angular/core', 'angular'],
  ['solid-js',      'solid'],
  ['svelte',        'svelte'],
  ['vue',           'vue'],
  ['react',         'react'],
  ['react-dom',     'react'],
]

export function detectFramework(deps: Record<string, string>): Framework {
  for (const [pkg, framework] of FRAMEWORK_PACKAGES) {
    if (pkg in deps) return framework
  }
  return 'unknown'
}

export function detectFrameworkFromTree(paths: string[]): Framework {
  if (paths.some(p => /\.component\.ts$/.test(p)))      return 'angular'
  if (paths.some(p => p.endsWith('.vue')))               return 'vue'
  if (paths.some(p => p.endsWith('.svelte')))            return 'svelte'
  if (paths.some(p => p.endsWith('.tsx') || p.endsWith('.jsx'))) return 'react'
  if (paths.some(p => p.endsWith('.js')))                        return 'javascript'
  if (paths.some(p => p.endsWith('.ts')))                        return 'typescript'
  return 'unknown'
}

const VALID_EXTENSIONS: Record<Framework, string[]> = {
  react:      ['tsx', 'jsx', 'js'],
  solid:      ['tsx', 'jsx', 'js'],
  vue:        ['vue', 'js'],
  svelte:     ['svelte'],
  angular:    ['ts', 'tsx'],
  javascript: ['js'],
  typescript: ['ts'],
  unknown:    ['tsx', 'jsx', 'js', 'ts'],
}

const INCLUDE_PATTERNS = [
  '/components/', '/component/', '/ui/', '/primitives/', '/elements/', '/modules/',
]

export function isComponentFile(path: string, framework: Framework): boolean {
  const filename = path.split('/').pop() ?? ''
  const ext = filename.includes('.') ? filename.split('.').pop() ?? '' : ''

  // Extension check
  if (!VALID_EXTENSIONS[framework].includes(ext)) return false

  // Exclude patterns (checked before include to short-circuit early)
  if (/\.(test|spec|stories)\.[^.]+$/.test(filename))              return false
  if (/\.d\.[^.]+$/.test(filename))                                return false
  if (/^index\./.test(filename))                                     return false
  if (/(__tests__|__mocks__|node_modules|dist|\.storybook|(^|\/)tasks\/|(^|\/)scripts\/|(^|\/)build\/|(^|\/)tools\/|(^|\/)config\/)/.test(path)) return false

  const nameWithoutExt = filename.replace(/\.[^.]+$/, '')

  // Always exclude React hooks. Both camelCase (`useCallback`) and kebab-case
  // (`use-callback-ref` — Radix style) are hooks, not components.
  if (/^use[-A-Z]/.test(nameWithoutExt))                            return false

  // Include patterns
  const inIncludeDir = INCLUDE_PATTERNS.some(p => path.includes(p))
  const isFlatSrcRoot = /^src\/[A-Z][^/]+\.(tsx|jsx|js|vue|svelte)$/.test(path)
  // Monorepo with a /components|/ui|/etc dir under any depth of packages/...
  const isMonorepoIncludeDir = /^packages\/(?:[^/]+\/)+src\//.test(path) && inIncludeDir
  // Radix-style "package main entry": packages/.../<name>/src/<name>.{ext}
  // where the file basename matches the grandparent dir name. This is the
  // common pattern for one-component-per-package monorepos.
  const parts = path.split('/')
  const grandparent = parts.length >= 5 ? parts[parts.length - 3] : null
  const isMonorepoPackageEntry =
    parts.length >= 5
    && parts[0] === 'packages'
    && parts[parts.length - 2] === 'src'
    && grandparent === nameWithoutExt

  if (!inIncludeDir && !isFlatSrcRoot && !isMonorepoIncludeDir && !isMonorepoPackageEntry) return false

  // Outside a known component directory, require PascalCase to avoid picking up
  // utility modules. Inside /components/, /ui/, etc. trust the directory.
  // Monorepo package-entry files (basename matches grandparent dir) are also
  // trusted — they're the canonical export for that package.
  if (!inIncludeDir && !isMonorepoIncludeDir && !isMonorepoPackageEntry
      && nameWithoutExt === nameWithoutExt.toLowerCase()) return false

  return true
}
