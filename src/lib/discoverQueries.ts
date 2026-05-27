// ── View mode data ─────────────────────────────────────────────────

export const VIEW_MODES = [
  { key: 'home',        label: 'Home',        accent: '#60a5fa' },
  { key: 'recommended', label: 'Recommended', accent: '#8b5cf6' },
  { key: 'agents',      label: 'Agents',      accent: '#f59e0b' },
] as const

export type ViewModeKey = (typeof VIEW_MODES)[number]['key']

export function getViewModeAccent(key: ViewModeKey): string {
  return VIEW_MODES.find(vm => vm.key === key)?.accent ?? '#8b5cf6'
}

export function buildViewModeQuery(viewMode: ViewModeKey, langKey: string, search: string): string {
  const trimmed = search.trim()
  const langFilter = langKey ? `language:${langKey}` : ''

  if (trimmed) {
    return [trimmed, langFilter].filter(Boolean).join(' ')
  }

  switch (viewMode) {
    case 'recommended':
      return '' // handled by separate IPC handler
    case 'agents':
      return '' // agents come from window.api.agents.getAll(), not GitHub search
    case 'home':
      return langFilter
        ? `stars:>0 ${langFilter}`
        : 'stars:>100'
  }
}

export function getViewModeSort(_viewMode: ViewModeKey): { sort: string; order: string } {
  return { sort: 'stars', order: 'desc' }
}

// Map sub-type IDs to GitHub search keywords.  Used as plain-text search
// terms (matched against repo name, description, readme, and topics).
// Defaults to the sub-type ID (hyphens replaced with spaces) when no
// override is needed.
// Each value uses a GitHub `topic:` qualifier so the API returns repos that
// share the same topic signals the classifier's hasTopic() checks use.
// This keeps the API results and the client-side classifier in alignment:
// a repo fetched via topic:build-tool will also pass hasTopic('build-tool').
export const SUB_TYPE_KEYWORD: Record<string, string> = {
  // ── AI & ML ──────────────────────────────────────────────────────
  'ai-model':         'topic:machine-learning',
  'neural-net':       'topic:neural-network',
  'ai-agent':         'topic:ai-agent',
  'ai-coding':        'topic:ai-coding',
  'ml-framework':     'topic:deep-learning',
  'mlops':            'topic:mlops',
  'computer-vision':  'topic:computer-vision',
  'nlp-tool':         'topic:nlp',
  'vector-db':        'topic:vector-database',
  'prompt-lib':       'topic:prompt-engineering',
  'dataset':          'topic:dataset',
  // ── Dev Tools ─────────────────────────────────────────────────────
  'build-tool':       'topic:build-tool',
  'testing':          'topic:testing',
  'linter':           'topic:linter',
  'formatter':        'topic:formatter',
  'debugger':         'topic:debugger',
  'vcs-tool':         'topic:git',
  'pkg-manager':      'topic:package-manager',
  'doc-tool':         'topic:documentation',
  'static-analysis':  'topic:static-analysis',
  'api-tool':         'topic:openapi',
  'monorepo-tool':    'topic:monorepo',
  'code-generator':   'topic:codegen',
  'profiler':         'topic:profiling',
  'algorithm':        'topic:algorithm',
  // ── Frameworks ────────────────────────────────────────────────────
  'web-framework':    'topic:react',
  'backend-framework':'topic:django',
  'mobile-framework': 'topic:flutter',
  'desktop-framework':'topic:electron',
  'css-framework':    'topic:css-framework',
  'ui-library':       'topic:ui-components',
  'game-engine':      'topic:game-engine',
  'state-management': 'topic:state-management',
  'data-viz':         'topic:data-visualization',
  'animation':        'topic:animation',
  'auth-library':     'topic:jwt',
  // ── Language Projects ─────────────────────────────────────────────
  'lang-impl':        'topic:programming-language',
  'compiler':         'topic:compiler',
  'runtime':          'topic:runtime',
  'type-checker':     'topic:type-checker',
  'lang-server':      'topic:language-server',
  'pkg-registry':     'topic:package-registry',
  'transpiler':       'topic:transpiler',
  'repl':             'topic:repl',
  // ── Infrastructure ────────────────────────────────────────────────
  'ci-cd':            'topic:ci-cd',
  'container':        'topic:docker',
  'devops':           'topic:kubernetes',
  'database':         'topic:database',
  'monitoring':       'topic:monitoring',
  'cloud-platform':   'topic:cloud',
  'networking':       'topic:networking',
  'blockchain':       'topic:blockchain',
  'auth-infra':       'topic:identity',
  'message-queue':    'topic:kafka',
  'search-engine':    'topic:elasticsearch',
  'logging':          'topic:logging',
  'api-gateway':      'topic:api-gateway',
  // ── Utilities ────────────────────────────────────────────────────
  'cli-tool':         'topic:cli',
  'scraper':          'topic:web-scraper',
  'file-converter':   'topic:converter',
  'config-tool':      'topic:configuration',
  'i18n':             'topic:i18n',
  'notification':     'topic:notification',
  'plugin':           'topic:plugin',
  'boilerplate':      'topic:boilerplate',
  'library':          'topic:library',
  // ── Editors & IDEs ────────────────────────────────────────────────
  'code-editor':      'topic:neovim',
  'db-client':        'topic:database-client',
  'api-client-app':   'topic:rest-client',
  'terminal':         'topic:terminal',
  'notebook':         'topic:jupyter',
  'design-tool':      'topic:design',
  // ── Learning ─────────────────────────────────────────────────────
  'tutorial':         'topic:tutorial',
  'awesome-list':     'topic:awesome-list',
  'book':             'topic:book',
  'course':           'topic:course',
  'cheatsheet':       'topic:cheatsheet',
  'coding-challenge': 'topic:coding-challenge',
  'interview-prep':   'topic:interview',
  'research-paper':   'topic:research-paper',
  'roadmap':          'topic:roadmap',
}

export function getSubTypeKeyword(subTypeId: string): string {
  return SUB_TYPE_KEYWORD[subTypeId] ?? subTypeId.replace(/-/g, ' ')
}
