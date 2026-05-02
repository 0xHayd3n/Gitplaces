// src/types/components.ts
export type Framework = 'react' | 'vue' | 'svelte' | 'solid' | 'angular' | 'javascript' | 'typescript' | 'unknown'

export type RenderTier = 'bundled' | 'source'

export interface ScannedComponent {
  path: string    // e.g. "src/components/Button.tsx"
  source: string  // raw file content
}

export interface ScannedStory {
  path: string    // e.g. "src/components/Button.stories.tsx"
  source: string  // raw file content
}

export interface ComponentScanResult {
  framework: Framework
  pkg: { name: string; version: string } | null
  components: ScannedComponent[]
  stories: ScannedStory[]
  error: 'rate-limit' | 'network' | 'timeout' | null
}

export interface BundledRender {
  importUrl: string         // e.g. "https://esm.sh/@radix-ui/react-dialog@1.0.5"
  exportName: string        // e.g. "Root"
  cssUrls: string[]         // e.g. ["https://esm.sh/@mantine/core@7.6.0/styles.css"]
}

export interface Variant {
  name: string                       // "Primary", "default", etc.
  props: Record<string, unknown>     // arg values for this render
  source: 'story' | 'auto' | 'default'
}
