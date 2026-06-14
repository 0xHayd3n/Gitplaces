import { describe, it, expect } from 'vitest'
import { classifyRepoType, classifyRepoBucket } from './classifyRepoType'

interface ClassifyInput {
  name: string
  description: string | null
  topics: string[]
}

/**
 * Build a minimal input for classifyRepoBucket/classifyRepoType. Accepts the
 * pre-Phase-2 `topics: string` (JSON) form so the historical test cases below
 * can stay readable as-is; this helper parses to string[] before passing on.
 */
function makeRepo(overrides: Partial<{
  name: string
  description: string | null
  topics: string | string[]
}>): ClassifyInput {
  const t = overrides.topics
  let topics: string[] = []
  if (Array.isArray(t)) {
    topics = t
  } else if (typeof t === 'string') {
    try {
      const parsed = JSON.parse(t)
      if (Array.isArray(parsed)) topics = parsed
    } catch {
      topics = []
    }
  }
  return {
    name: overrides.name ?? 'repo',
    description: overrides.description ?? null,
    topics,
  }
}

describe('classifyRepoType', () => {
  it('classifies tool by topic', () => {
    const repo = makeRepo({ topics: '["cli","tool"]' })
    expect(classifyRepoType(repo)).toBe('tool')
  })

  it('falls back to other with no signals', () => {
    const repo = makeRepo({ name: 'random-project' })
    expect(classifyRepoType(repo)).toBe('other')
  })

  it('handles malformed topics JSON gracefully', () => {
    const repo = makeRepo({ topics: 'not-json' })
    expect(classifyRepoType(repo)).toBe('other')
  })

  it('handles null description without throwing', () => {
    const repo = makeRepo({ description: null, topics: '["cli"]' })
    expect(classifyRepoType(repo)).toBe('tool')
  })
})

describe('classifyRepoBucket', () => {
  // ── AI & ML — topics ──────────────────────────────────────────────

  it('classifies llm topic as ai-ml/ai-model', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["llm"]' }))).toEqual({ bucket: 'ai-ml', subType: 'ai-model' })
  })
  it('classifies ai-agent topic as ai-ml/ai-agent', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["ai-agent"]' }))).toEqual({ bucket: 'ai-ml', subType: 'ai-agent' })
  })
  it('classifies agents (plural) topic as ai-ml/ai-agent', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["agents"]' }))).toEqual({ bucket: 'ai-ml', subType: 'ai-agent' })
  })
  it('classifies agentic-ai topic as ai-ml/ai-agent', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["agentic-ai"]' }))).toEqual({ bucket: 'ai-ml', subType: 'ai-agent' })
  })
  it('classifies prompt topic as ai-ml/prompt-lib', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["prompt-engineering"]' }))).toEqual({ bucket: 'ai-ml', subType: 'prompt-lib' })
  })
  it('classifies pytorch topic as ai-ml/ml-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["pytorch"]' }))).toEqual({ bucket: 'ai-ml', subType: 'ml-framework' })
  })
  it('classifies tensorflow topic as ai-ml/ml-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["tensorflow"]' }))).toEqual({ bucket: 'ai-ml', subType: 'ml-framework' })
  })
  it('classifies dataset topic as ai-ml/dataset', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["dataset"]' }))).toEqual({ bucket: 'ai-ml', subType: 'dataset' })
  })
  it('classifies neural-network topic as ai-ml/neural-net', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["neural-network"]' }))).toEqual({ bucket: 'ai-ml', subType: 'neural-net' })
  })
  it('classifies gan topic as ai-ml/neural-net', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["gan"]' }))).toEqual({ bucket: 'ai-ml', subType: 'neural-net' })
  })
  it('classifies computer-vision topic as ai-ml/computer-vision', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["computer-vision"]' }))).toEqual({ bucket: 'ai-ml', subType: 'computer-vision' })
  })
  it('classifies nlp topic as ai-ml/nlp-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["nlp"]' }))).toEqual({ bucket: 'ai-ml', subType: 'nlp-tool' })
  })
  it('classifies standalone ai topic as ai-ml/ai-model', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["ai"]' }))).toEqual({ bucket: 'ai-ml', subType: 'ai-model' })
  })
  it('classifies deep-learning topic as ai-ml/ai-model', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["deep-learning"]' }))).toEqual({ bucket: 'ai-ml', subType: 'ai-model' })
  })

  // ── AI & ML — new sub-types ───────────────────────────────────────
  it('classifies mlops topic as ai-ml/mlops', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["mlops"]' }))).toEqual({ bucket: 'ai-ml', subType: 'mlops' })
  })
  it('classifies mlflow topic as ai-ml/mlops', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["mlflow"]' }))).toEqual({ bucket: 'ai-ml', subType: 'mlops' })
  })
  it('classifies opencv topic as ai-ml/computer-vision', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["opencv"]' }))).toEqual({ bucket: 'ai-ml', subType: 'computer-vision' })
  })
  it('classifies spacy topic as ai-ml/nlp-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["spacy"]' }))).toEqual({ bucket: 'ai-ml', subType: 'nlp-tool' })
  })
  it('classifies vector-database topic as ai-ml/vector-db', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["vector-database"]' }))).toEqual({ bucket: 'ai-ml', subType: 'vector-db' })
  })
  it('classifies chromadb name as ai-ml/vector-db', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'chromadb' }))).toEqual({ bucket: 'ai-ml', subType: 'vector-db' })
  })
  it('classifies ai-coding topic as ai-ml/ai-coding', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["ai-coding"]' }))).toEqual({ bucket: 'ai-ml', subType: 'ai-coding' })
  })
  it('classifies code-assistant topic as ai-ml/ai-coding', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["code-assistant"]' }))).toEqual({ bucket: 'ai-ml', subType: 'ai-coding' })
  })
  it('classifies computer vision by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A computer vision library for detecting objects' }))).toEqual({ bucket: 'ai-ml', subType: 'computer-vision' })
  })
  it('classifies mlops by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'An mlops platform for model serving and deployment' }))).toEqual({ bucket: 'ai-ml', subType: 'mlops' })
  })
  it('classifies nlp by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A natural language processing toolkit for text processing' }))).toEqual({ bucket: 'ai-ml', subType: 'nlp-tool' })
  })
  it('classifies vector-db by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A vector database for similarity search' }))).toEqual({ bucket: 'ai-ml', subType: 'vector-db' })
  })
  it('classifies ai-coding by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'An ai coding assistant for code completion' }))).toEqual({ bucket: 'ai-ml', subType: 'ai-coding' })
  })

  // ── Learning — topics ─────────────────────────────────────────────

  it('classifies awesome-list topic as learning/awesome-list', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["awesome-list"]' }))).toEqual({ bucket: 'learning', subType: 'awesome-list' })
  })
  it('classifies awesome topic as learning/awesome-list', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["awesome"]' }))).toEqual({ bucket: 'learning', subType: 'awesome-list' })
  })
  it('classifies book topic as learning/book', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["book"]' }))).toEqual({ bucket: 'learning', subType: 'book' })
  })
  it('classifies book-series topic as learning/book', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["book-series"]' }))).toEqual({ bucket: 'learning', subType: 'book' })
  })
  it('classifies tutorial topic as learning/tutorial', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["tutorial"]' }))).toEqual({ bucket: 'learning', subType: 'tutorial' })
  })
  it('classifies education topic as learning/tutorial', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["education"]' }))).toEqual({ bucket: 'learning', subType: 'tutorial' })
  })
  it('classifies course topic as learning/course', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["course"]' }))).toEqual({ bucket: 'learning', subType: 'course' })
  })
  it('classifies cheatsheet topic as learning/cheatsheet', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["cheatsheet"]' }))).toEqual({ bucket: 'learning', subType: 'cheatsheet' })
  })

  // ── Learning — new sub-types ──────────────────────────────────────
  it('classifies interview topic as learning/interview-prep', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["interview"]' }))).toEqual({ bucket: 'learning', subType: 'interview-prep' })
  })
  it('classifies leetcode topic as learning/interview-prep', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["leetcode"]' }))).toEqual({ bucket: 'learning', subType: 'interview-prep' })
  })
  it('classifies coding-interview topic as learning/interview-prep', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["coding-interview"]' }))).toEqual({ bucket: 'learning', subType: 'interview-prep' })
  })
  it('classifies roadmap topic as learning/roadmap', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["roadmap"]' }))).toEqual({ bucket: 'learning', subType: 'roadmap' })
  })
  it('classifies roadmap name as learning/roadmap', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'developer-roadmap' }))).toEqual({ bucket: 'learning', subType: 'roadmap' })
  })
  it('classifies coding-challenge topic as learning/coding-challenge', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["coding-challenge"]' }))).toEqual({ bucket: 'learning', subType: 'coding-challenge' })
  })
  it('classifies competitive-programming topic as learning/coding-challenge', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["competitive-programming"]' }))).toEqual({ bucket: 'learning', subType: 'coding-challenge' })
  })
  it('classifies research-paper topic as learning/research-paper', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["research-paper"]' }))).toEqual({ bucket: 'learning', subType: 'research-paper' })
  })
  it('classifies arxiv topic as learning/research-paper', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["arxiv"]' }))).toEqual({ bucket: 'learning', subType: 'research-paper' })
  })
  it('classifies interview prep by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myrepo', description: 'A collection of coding interview questions and solutions' }))).toEqual({ bucket: 'learning', subType: 'interview-prep' })
  })
  it('classifies roadmap by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myrepo', description: 'A developer roadmap and learning path for backend engineers' }))).toEqual({ bucket: 'learning', subType: 'roadmap' })
  })
  it('classifies coding challenge by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myrepo', description: 'A set of coding challenge solutions and practice problems' }))).toEqual({ bucket: 'learning', subType: 'coding-challenge' })
  })
  it('classifies research paper by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myrepo', description: 'Implementation of a research paper on transformers' }))).toEqual({ bucket: 'learning', subType: 'research-paper' })
  })

  // ── Frameworks — topics ───────────────────────────────────────────

  it('classifies css-framework topic as frameworks/css-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["css-framework"]' }))).toEqual({ bucket: 'frameworks', subType: 'css-framework' })
  })
  it('classifies css topic as frameworks/css-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["css"]' }))).toEqual({ bucket: 'frameworks', subType: 'css-framework' })
  })
  it('classifies tailwindcss topic as frameworks/css-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["tailwindcss"]' }))).toEqual({ bucket: 'frameworks', subType: 'css-framework' })
  })
  it('classifies component-library topic as frameworks/ui-library', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["component-library"]' }))).toEqual({ bucket: 'frameworks', subType: 'ui-library' })
  })
  it('classifies component topic as frameworks/ui-library', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["component"]' }))).toEqual({ bucket: 'frameworks', subType: 'ui-library' })
  })
  it('classifies design-system topic as frameworks/ui-library', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["design-system"]' }))).toEqual({ bucket: 'frameworks', subType: 'ui-library' })
  })
  it('classifies react topic as frameworks/web-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["react"]' }))).toEqual({ bucket: 'frameworks', subType: 'web-framework' })
  })
  it('classifies vue topic as frameworks/web-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["vue"]' }))).toEqual({ bucket: 'frameworks', subType: 'web-framework' })
  })
  it('classifies nextjs topic as frameworks/web-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["nextjs"]' }))).toEqual({ bucket: 'frameworks', subType: 'web-framework' })
  })
  it('classifies django topic as frameworks/backend-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["django"]' }))).toEqual({ bucket: 'frameworks', subType: 'backend-framework' })
  })
  it('classifies fastapi topic as frameworks/backend-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["fastapi"]' }))).toEqual({ bucket: 'frameworks', subType: 'backend-framework' })
  })
  it('classifies flutter topic as frameworks/mobile-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["flutter"]' }))).toEqual({ bucket: 'frameworks', subType: 'mobile-framework' })
  })
  it('classifies react-native topic as frameworks/mobile-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["react-native"]' }))).toEqual({ bucket: 'frameworks', subType: 'mobile-framework' })
  })
  it('classifies unity topic as frameworks/game-engine', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["unity"]' }))).toEqual({ bucket: 'frameworks', subType: 'game-engine' })
  })
  it('classifies godot topic as frameworks/game-engine', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["godot"]' }))).toEqual({ bucket: 'frameworks', subType: 'game-engine' })
  })

  // ── Frameworks — new sub-types ────────────────────────────────────
  it('classifies electron topic as frameworks/desktop-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["electron"]' }))).toEqual({ bucket: 'frameworks', subType: 'desktop-framework' })
  })
  it('classifies tauri topic as frameworks/desktop-framework', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["tauri"]' }))).toEqual({ bucket: 'frameworks', subType: 'desktop-framework' })
  })
  it('classifies state-management topic as frameworks/state-management', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["state-management"]' }))).toEqual({ bucket: 'frameworks', subType: 'state-management' })
  })
  it('classifies redux topic as frameworks/state-management', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["redux"]' }))).toEqual({ bucket: 'frameworks', subType: 'state-management' })
  })
  it('classifies zustand name as frameworks/state-management', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'zustand' }))).toEqual({ bucket: 'frameworks', subType: 'state-management' })
  })
  it('classifies data-visualization topic as frameworks/data-viz', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["data-visualization"]' }))).toEqual({ bucket: 'frameworks', subType: 'data-viz' })
  })
  it('classifies d3 name as frameworks/data-viz', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'd3' }))).toEqual({ bucket: 'frameworks', subType: 'data-viz' })
  })
  it('classifies animation topic as frameworks/animation', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["animation"]' }))).toEqual({ bucket: 'frameworks', subType: 'animation' })
  })
  it('classifies threejs topic as frameworks/animation', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["threejs"]' }))).toEqual({ bucket: 'frameworks', subType: 'animation' })
  })
  it('classifies passport topic as frameworks/auth-library', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["passport"]' }))).toEqual({ bucket: 'frameworks', subType: 'auth-library' })
  })
  it('classifies nextauth topic as frameworks/auth-library', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["nextauth"]' }))).toEqual({ bucket: 'frameworks', subType: 'auth-library' })
  })
  it('classifies data viz by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A data visualization library for interactive charts' }))).toEqual({ bucket: 'frameworks', subType: 'data-viz' })
  })
  it('classifies desktop framework by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myapp', description: 'Build cross-platform desktop applications with web tech' }))).toEqual({ bucket: 'frameworks', subType: 'desktop-framework' })
  })
  it('classifies state management by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A state management library for React apps' }))).toEqual({ bucket: 'frameworks', subType: 'state-management' })
  })
  it('classifies animation by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A motion library for smooth UI animations' }))).toEqual({ bucket: 'frameworks', subType: 'animation' })
  })
  it('classifies auth library by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'An authentication library for Node.js apps' }))).toEqual({ bucket: 'frameworks', subType: 'auth-library' })
  })

  // ── Language Projects — topics ────────────────────────────────────

  it('classifies compiler topic as lang-projects/compiler', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["compiler"]' }))).toEqual({ bucket: 'lang-projects', subType: 'compiler' })
  })
  it('classifies llvm topic as lang-projects/compiler', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["llvm"]' }))).toEqual({ bucket: 'lang-projects', subType: 'compiler' })
  })
  it('classifies transpiler topic as lang-projects/transpiler', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["transpiler"]' }))).toEqual({ bucket: 'lang-projects', subType: 'transpiler' })
  })
  it('classifies babel topic as lang-projects/transpiler', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["babel"]' }))).toEqual({ bucket: 'lang-projects', subType: 'transpiler' })
  })
  it('classifies runtime topic as lang-projects/runtime', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["runtime"]' }))).toEqual({ bucket: 'lang-projects', subType: 'runtime' })
  })
  it('classifies deno topic as lang-projects/runtime', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["deno"]' }))).toEqual({ bucket: 'lang-projects', subType: 'runtime' })
  })
  it('classifies wasm topic as lang-projects/runtime', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["wasm"]' }))).toEqual({ bucket: 'lang-projects', subType: 'runtime' })
  })
  it('classifies programming-language topic as lang-projects/lang-impl', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["programming-language"]' }))).toEqual({ bucket: 'lang-projects', subType: 'lang-impl' })
  })
  it('classifies interpreter topic as lang-projects/lang-impl', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["interpreter"]' }))).toEqual({ bucket: 'lang-projects', subType: 'lang-impl' })
  })
  it('classifies style-guide topic as lang-projects/style-guide', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["style-guide"]' }))).toEqual({ bucket: 'lang-projects', subType: 'style-guide' })
  })

  // ── Language Projects — new sub-types ─────────────────────────────
  it('classifies type-checker topic as lang-projects/type-checker', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["type-checker"]' }))).toEqual({ bucket: 'lang-projects', subType: 'type-checker' })
  })
  it('classifies mypy topic as lang-projects/type-checker', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["mypy"]' }))).toEqual({ bucket: 'lang-projects', subType: 'type-checker' })
  })
  it('classifies pyright name as lang-projects/type-checker', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'pyright' }))).toEqual({ bucket: 'lang-projects', subType: 'type-checker' })
  })
  it('classifies lsp topic as lang-projects/lang-server', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["lsp"]' }))).toEqual({ bucket: 'lang-projects', subType: 'lang-server' })
  })
  it('classifies rust-analyzer name as lang-projects/lang-server', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'rust-analyzer' }))).toEqual({ bucket: 'lang-projects', subType: 'lang-server' })
  })
  it('classifies repl topic as lang-projects/repl', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["repl"]' }))).toEqual({ bucket: 'lang-projects', subType: 'repl' })
  })
  it('classifies ipython name as lang-projects/repl', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'ipython' }))).toEqual({ bucket: 'lang-projects', subType: 'repl' })
  })
  it('classifies package-registry topic as lang-projects/pkg-registry', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["package-registry"]' }))).toEqual({ bucket: 'lang-projects', subType: 'pkg-registry' })
  })
  it('classifies verdaccio name as lang-projects/pkg-registry', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'verdaccio' }))).toEqual({ bucket: 'lang-projects', subType: 'pkg-registry' })
  })
  it('classifies type checker by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A fast type checker for Python code' }))).toEqual({ bucket: 'lang-projects', subType: 'type-checker' })
  })
  it('classifies language server by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A language server protocol implementation for Go' }))).toEqual({ bucket: 'lang-projects', subType: 'lang-server' })
  })
  it('classifies repl by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'An interactive shell and repl for Ruby' }))).toEqual({ bucket: 'lang-projects', subType: 'repl' })
  })
  it('classifies package registry by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A private registry for npm packages' }))).toEqual({ bucket: 'lang-projects', subType: 'pkg-registry' })
  })

  // ── Dev Tools — topics ────────────────────────────────────────────

  it('classifies algorithm topic as dev-tools/algorithm', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["algorithm"]' }))).toEqual({ bucket: 'dev-tools', subType: 'algorithm' })
  })
  it('classifies jest topic as dev-tools/testing', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["jest"]' }))).toEqual({ bucket: 'dev-tools', subType: 'testing' })
  })

  // ── Dev Tools — new sub-types ─────────────────────────────────────
  it('classifies profiler topic as dev-tools/profiler', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["profiler"]' }))).toEqual({ bucket: 'dev-tools', subType: 'profiler' })
  })
  it('classifies flamegraph topic as dev-tools/profiler', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["flamegraph"]' }))).toEqual({ bucket: 'dev-tools', subType: 'profiler' })
  })
  it('classifies code-generator topic as dev-tools/code-generator', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["code-generator"]' }))).toEqual({ bucket: 'dev-tools', subType: 'code-generator' })
  })
  it('classifies yeoman name as dev-tools/code-generator', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'yeoman' }))).toEqual({ bucket: 'dev-tools', subType: 'code-generator' })
  })
  it('classifies documentation topic as dev-tools/doc-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["documentation"]' }))).toEqual({ bucket: 'dev-tools', subType: 'doc-tool' })
  })
  it('classifies docusaurus name as dev-tools/doc-tool', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'docusaurus' }))).toEqual({ bucket: 'dev-tools', subType: 'doc-tool' })
  })
  it('classifies static-analysis topic as dev-tools/static-analysis', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["static-analysis"]' }))).toEqual({ bucket: 'dev-tools', subType: 'static-analysis' })
  })
  it('classifies semgrep name as dev-tools/static-analysis', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'semgrep' }))).toEqual({ bucket: 'dev-tools', subType: 'static-analysis' })
  })
  it('classifies swagger topic as dev-tools/api-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["swagger"]' }))).toEqual({ bucket: 'dev-tools', subType: 'api-tool' })
  })
  it('classifies openapi topic as dev-tools/api-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["openapi"]' }))).toEqual({ bucket: 'dev-tools', subType: 'api-tool' })
  })
  it('classifies monorepo topic as dev-tools/monorepo-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["monorepo"]' }))).toEqual({ bucket: 'dev-tools', subType: 'monorepo-tool' })
  })
  it('classifies turborepo name as dev-tools/monorepo-tool', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'turborepo' }))).toEqual({ bucket: 'dev-tools', subType: 'monorepo-tool' })
  })
  it('classifies doc tool by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A documentation tool for generating API docs' }))).toEqual({ bucket: 'dev-tools', subType: 'doc-tool' })
  })
  it('classifies profiler by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A profiling tool for finding performance bottlenecks' }))).toEqual({ bucket: 'dev-tools', subType: 'profiler' })
  })
  it('classifies code generator by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A code generator that scaffolding tool for new projects' }))).toEqual({ bucket: 'dev-tools', subType: 'code-generator' })
  })
  it('classifies static analysis by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A static analysis tool for code quality checks' }))).toEqual({ bucket: 'dev-tools', subType: 'static-analysis' })
  })
  it('classifies api tool by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'An api tool for api design and testing' }))).toEqual({ bucket: 'dev-tools', subType: 'api-tool' })
  })
  it('classifies monorepo by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A monorepo tool for workspace management' }))).toEqual({ bucket: 'dev-tools', subType: 'monorepo-tool' })
  })

  // ── Editors — topics ──────────────────────────────────────────────

  it('classifies text-editor topic as editors/text-editor', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["text-editor"]' }))).toEqual({ bucket: 'editors', subType: 'text-editor' })
  })
  it('classifies sublime topic as editors/text-editor', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["sublime"]' }))).toEqual({ bucket: 'editors', subType: 'text-editor' })
  })
  it('classifies design topic as editors/design-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["design"]' }))).toEqual({ bucket: 'editors', subType: 'design-tool' })
  })
  it('classifies canvas topic as editors/design-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["canvas"]' }))).toEqual({ bucket: 'editors', subType: 'design-tool' })
  })

  // ── Editors — new sub-types ───────────────────────────────────────
  it('classifies database-client topic as editors/db-client', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["database-client"]' }))).toEqual({ bucket: 'editors', subType: 'db-client' })
  })
  it('classifies database-gui topic as editors/db-client', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["database-gui"]' }))).toEqual({ bucket: 'editors', subType: 'db-client' })
  })
  it('classifies dbeaver name as editors/db-client', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'dbeaver' }))).toEqual({ bucket: 'editors', subType: 'db-client' })
  })
  it('classifies hoppscotch topic as editors/api-client-app', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["hoppscotch"]' }))).toEqual({ bucket: 'editors', subType: 'api-client-app' })
  })
  it('classifies rest-client topic as editors/api-client-app', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["rest-client"]' }))).toEqual({ bucket: 'editors', subType: 'api-client-app' })
  })
  it('classifies bruno name as editors/api-client-app', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'bruno' }))).toEqual({ bucket: 'editors', subType: 'api-client-app' })
  })
  it('classifies diff-tool topic as editors/diff-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["diff-tool"]' }))).toEqual({ bucket: 'editors', subType: 'diff-tool' })
  })
  it('classifies delta name as editors/diff-tool', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'delta' }))).toEqual({ bucket: 'editors', subType: 'diff-tool' })
  })
  it('classifies file-manager topic as editors/file-manager', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["file-manager"]' }))).toEqual({ bucket: 'editors', subType: 'file-manager' })
  })
  it('classifies yazi name as editors/file-manager', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'yazi' }))).toEqual({ bucket: 'editors', subType: 'file-manager' })
  })
  it('classifies db client by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myapp', description: 'A database gui for managing PostgreSQL' }))).toEqual({ bucket: 'editors', subType: 'db-client' })
  })
  it('classifies rest client by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myapp', description: 'A lightweight http client for testing APIs' }))).toEqual({ bucket: 'editors', subType: 'api-client-app' })
  })
  it('classifies diff tool by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myapp', description: 'A syntax-aware diff tool for code review' }))).toEqual({ bucket: 'editors', subType: 'diff-tool' })
  })
  it('classifies file manager by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myapp', description: 'A terminal file manager with vim keybindings' }))).toEqual({ bucket: 'editors', subType: 'file-manager' })
  })

  // ── Infrastructure — topics ───────────────────────────────────────

  it('classifies docker topic as infrastructure/container', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["docker"]' }))).toEqual({ bucket: 'infrastructure', subType: 'container' })
  })
  it('classifies cli topic as utilities/cli-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["cli"]' }))).toEqual({ bucket: 'utilities', subType: 'cli-tool' })
  })
  it('classifies aws topic as infrastructure/cloud-platform', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["aws"]' }))).toEqual({ bucket: 'infrastructure', subType: 'cloud-platform' })
  })
  it('classifies serverless topic as infrastructure/cloud-platform', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["serverless"]' }))).toEqual({ bucket: 'infrastructure', subType: 'cloud-platform' })
  })
  it('classifies vercel topic as infrastructure/cloud-platform', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["vercel"]' }))).toEqual({ bucket: 'infrastructure', subType: 'cloud-platform' })
  })
  it('classifies blockchain topic as infrastructure/blockchain', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["blockchain"]' }))).toEqual({ bucket: 'infrastructure', subType: 'blockchain' })
  })
  it('classifies ethereum topic as infrastructure/blockchain', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["ethereum"]' }))).toEqual({ bucket: 'infrastructure', subType: 'blockchain' })
  })
  it('classifies solidity topic as infrastructure/blockchain', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["solidity"]' }))).toEqual({ bucket: 'infrastructure', subType: 'blockchain' })
  })
  it('classifies web3 topic as infrastructure/blockchain', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["web3"]' }))).toEqual({ bucket: 'infrastructure', subType: 'blockchain' })
  })

  // ── Infrastructure — new sub-types ────────────────────────────────
  it('classifies kafka topic as infrastructure/message-queue', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["kafka"]' }))).toEqual({ bucket: 'infrastructure', subType: 'message-queue' })
  })
  it('classifies rabbitmq topic as infrastructure/message-queue', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["rabbitmq"]' }))).toEqual({ bucket: 'infrastructure', subType: 'message-queue' })
  })
  it('classifies message-queue topic as infrastructure/message-queue', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["message-queue"]' }))).toEqual({ bucket: 'infrastructure', subType: 'message-queue' })
  })
  it('classifies ci-cd topic as infrastructure/ci-cd', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["ci-cd"]' }))).toEqual({ bucket: 'infrastructure', subType: 'ci-cd' })
  })
  it('classifies github-actions topic as infrastructure/ci-cd', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["github-actions"]' }))).toEqual({ bucket: 'infrastructure', subType: 'ci-cd' })
  })
  it('classifies jenkins name as infrastructure/ci-cd', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'jenkins' }))).toEqual({ bucket: 'infrastructure', subType: 'ci-cd' })
  })
  it('classifies elasticsearch topic as infrastructure/search-engine', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["elasticsearch"]' }))).toEqual({ bucket: 'infrastructure', subType: 'search-engine' })
  })
  it('classifies meilisearch name as infrastructure/search-engine', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'meilisearch' }))).toEqual({ bucket: 'infrastructure', subType: 'search-engine' })
  })
  it('classifies identity-provider topic as infrastructure/auth-infra', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["identity-provider"]' }))).toEqual({ bucket: 'infrastructure', subType: 'auth-infra' })
  })
  it('classifies keycloak name as infrastructure/auth-infra', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'keycloak' }))).toEqual({ bucket: 'infrastructure', subType: 'auth-infra' })
  })
  it('classifies sso topic as infrastructure/auth-infra', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["sso"]' }))).toEqual({ bucket: 'infrastructure', subType: 'auth-infra' })
  })
  it('classifies api-gateway topic as infrastructure/api-gateway', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["api-gateway"]' }))).toEqual({ bucket: 'infrastructure', subType: 'api-gateway' })
  })
  it('classifies kong name as infrastructure/api-gateway', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'kong' }))).toEqual({ bucket: 'infrastructure', subType: 'api-gateway' })
  })
  it('classifies logging topic as infrastructure/logging', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["logging"]' }))).toEqual({ bucket: 'infrastructure', subType: 'logging' })
  })
  it('classifies loki name as infrastructure/logging', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'loki' }))).toEqual({ bucket: 'infrastructure', subType: 'logging' })
  })
  it('classifies ci/cd by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myci', description: 'A continuous integration and continuous deployment pipeline tool' }))).toEqual({ bucket: 'infrastructure', subType: 'ci-cd' })
  })
  it('classifies message queue by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A fast message queue for event streaming' }))).toEqual({ bucket: 'infrastructure', subType: 'message-queue' })
  })
  it('classifies search engine by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A blazing fast search engine with full-text search' }))).toEqual({ bucket: 'infrastructure', subType: 'search-engine' })
  })
  it('classifies auth infra by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'An identity provider with single sign-on support' }))).toEqual({ bucket: 'infrastructure', subType: 'auth-infra' })
  })
  it('classifies api gateway by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'An api gateway for microservices api management' }))).toEqual({ bucket: 'infrastructure', subType: 'api-gateway' })
  })
  it('classifies logging by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A structured logging library for log aggregation' }))).toEqual({ bucket: 'infrastructure', subType: 'logging' })
  })

  // ── Utilities — topics ────────────────────────────────────────────

  it('classifies platform topic as utilities/platform', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["platform"]' }))).toEqual({ bucket: 'utilities', subType: 'platform' })
  })
  it('classifies saas topic as utilities/platform', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["saas"]' }))).toEqual({ bucket: 'utilities', subType: 'platform' })
  })
  it('classifies automation topic as utilities/automation', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["automation"]' }))).toEqual({ bucket: 'utilities', subType: 'automation' })
  })
  it('classifies workflow topic as utilities/automation', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["workflow"]' }))).toEqual({ bucket: 'utilities', subType: 'automation' })
  })

  // ── Utilities — new sub-types ─────────────────────────────────────
  it('classifies scraper topic as utilities/scraper', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["scraper"]' }))).toEqual({ bucket: 'utilities', subType: 'scraper' })
  })
  it('classifies web-scraper topic as utilities/scraper', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["web-scraper"]' }))).toEqual({ bucket: 'utilities', subType: 'scraper' })
  })
  it('classifies puppeteer topic as utilities/scraper', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["puppeteer"]' }))).toEqual({ bucket: 'utilities', subType: 'scraper' })
  })
  it('classifies scrapy name as utilities/scraper', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'scrapy' }))).toEqual({ bucket: 'utilities', subType: 'scraper' })
  })
  it('classifies file-converter topic as utilities/file-converter', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["file-converter"]' }))).toEqual({ bucket: 'utilities', subType: 'file-converter' })
  })
  it('classifies ffmpeg name as utilities/file-converter', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'ffmpeg' }))).toEqual({ bucket: 'utilities', subType: 'file-converter' })
  })
  it('classifies pandoc name as utilities/file-converter', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'pandoc' }))).toEqual({ bucket: 'utilities', subType: 'file-converter' })
  })
  it('classifies i18n topic as utilities/i18n', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["i18n"]' }))).toEqual({ bucket: 'utilities', subType: 'i18n' })
  })
  it('classifies internationalization topic as utilities/i18n', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["internationalization"]' }))).toEqual({ bucket: 'utilities', subType: 'i18n' })
  })
  it('classifies i18next name as utilities/i18n', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'i18next' }))).toEqual({ bucket: 'utilities', subType: 'i18n' })
  })
  it('classifies config topic as utilities/config-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["config"]' }))).toEqual({ bucket: 'utilities', subType: 'config-tool' })
  })
  it('classifies dotenv name as utilities/config-tool', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'dotenv' }))).toEqual({ bucket: 'utilities', subType: 'config-tool' })
  })
  it('classifies feature-flag topic as utilities/config-tool', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["feature-flag"]' }))).toEqual({ bucket: 'utilities', subType: 'config-tool' })
  })
  it('classifies notification topic as utilities/notification', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["notification"]' }))).toEqual({ bucket: 'utilities', subType: 'notification' })
  })
  it('classifies ntfy name as utilities/notification', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'ntfy' }))).toEqual({ bucket: 'utilities', subType: 'notification' })
  })
  it('classifies push-notification topic as utilities/notification', () => {
    expect(classifyRepoBucket(makeRepo({ topics: '["push-notification"]' }))).toEqual({ bucket: 'utilities', subType: 'notification' })
  })
  it('classifies web scraper by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A fast web scraper for extracting data from sites' }))).toEqual({ bucket: 'utilities', subType: 'scraper' })
  })
  it('classifies file converter by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A file converter for media converter tasks' }))).toEqual({ bucket: 'utilities', subType: 'file-converter' })
  })
  it('classifies i18n by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'An internationalization library for React apps' }))).toEqual({ bucket: 'utilities', subType: 'i18n' })
  })
  it('classifies config tool by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A configuration tool for managing environment variables' }))).toEqual({ bucket: 'utilities', subType: 'config-tool' })
  })
  it('classifies notification by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A push notification service for mobile apps' }))).toEqual({ bucket: 'utilities', subType: 'notification' })
  })

  // ── Name signals ──────────────────────────────────────────────────

  it('classifies neovim name as editors/code-editor', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'neovim-config' }))).toEqual({ bucket: 'editors', subType: 'code-editor' })
  })
  it('classifies eslint name as dev-tools/linter', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'eslint-plugin-react' }))).toEqual({ bucket: 'dev-tools', subType: 'linter' })
  })
  it('classifies postgres name as infrastructure/database', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'postgres-client' }))).toEqual({ bucket: 'infrastructure', subType: 'database' })
  })
  it('classifies boilerplate name as utilities/boilerplate', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'react-boilerplate' }))).toEqual({ bucket: 'utilities', subType: 'boilerplate' })
  })
  it('classifies pytorch name as ai-ml/ml-framework', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'pytorch-lightning' }))).toEqual({ bucket: 'ai-ml', subType: 'ml-framework' })
  })
  it('classifies compiler name as lang-projects/compiler', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'tiny-compiler' }))).toEqual({ bucket: 'lang-projects', subType: 'compiler' })
  })
  it('classifies babel name as lang-projects/transpiler', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'babel-preset-env' }))).toEqual({ bucket: 'lang-projects', subType: 'transpiler' })
  })
  it('classifies deno name as lang-projects/runtime', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'deno-std' }))).toEqual({ bucket: 'lang-projects', subType: 'runtime' })
  })
  it('classifies notepad name as editors/text-editor', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'notepad-plus-plus' }))).toEqual({ bucket: 'editors', subType: 'text-editor' })
  })
  it('classifies aws name as infrastructure/cloud-platform', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'aws-cdk' }))).toEqual({ bucket: 'infrastructure', subType: 'cloud-platform' })
  })
  it('classifies bulma name as frameworks/css-framework', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'bulma' }))).toEqual({ bucket: 'frameworks', subType: 'css-framework' })
  })
  it('classifies django name as frameworks/backend-framework', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'django-rest-framework' }))).toEqual({ bucket: 'frameworks', subType: 'backend-framework' })
  })
  it('classifies flutter name as frameworks/mobile-framework', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'flutter-examples' }))).toEqual({ bucket: 'frameworks', subType: 'mobile-framework' })
  })

  // ── Description signals ───────────────────────────────────────────

  it('classifies ML framework by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'An ml framework for Python' }))).toEqual({ bucket: 'ai-ml', subType: 'ml-framework' })
  })
  it('classifies dataset by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mydata', description: 'A curated dataset for NER tasks' }))).toEqual({ bucket: 'ai-ml', subType: 'dataset' })
  })
  it('classifies compiler by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myproject', description: 'A fast compiler for the Zig language' }))).toEqual({ bucket: 'lang-projects', subType: 'compiler' })
  })
  it('classifies component library by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A component library for React' }))).toEqual({ bucket: 'frameworks', subType: 'ui-library' })
  })
  it('classifies component system by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'mylib', description: 'A component system for building SaaS products' }))).toEqual({ bucket: 'frameworks', subType: 'ui-library' })
  })
  it('classifies design tool by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myapp', description: 'The open-source design tool for design and code collaboration' }))).toEqual({ bucket: 'editors', subType: 'design-tool' })
  })
  it('classifies whiteboard by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myapp', description: 'Very good whiteboard infinite canvas SDK' }))).toEqual({ bucket: 'editors', subType: 'design-tool' })
  })
  it('classifies tutorial by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myproject', description: 'A multi-module course teaching everything' }))).toEqual({ bucket: 'learning', subType: 'tutorial' })
  })
  it('classifies automation by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myproject', description: 'Fair-code workflow automation platform' }))).toEqual({ bucket: 'utilities', subType: 'automation' })
  })
  it('classifies blockchain by description', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'myproject', description: 'Build decentralized apps on blockchain' }))).toEqual({ bucket: 'infrastructure', subType: 'blockchain' })
  })

  // ── Real-world repos from screenshot ──────────────────────────────

  it('classifies bulma (CSS framework)', () => {
    expect(classifyRepoBucket(makeRepo({
      name: 'bulma', topics: '["css","css-framework","design"]',
      description: 'Modern CSS framework based on Flexbox',
    }))).toEqual({ bucket: 'frameworks', subType: 'css-framework' })
  })
  it('classifies AutoGPT (AI agent)', () => {
    expect(classifyRepoBucket(makeRepo({
      name: 'AutoGPT', topics: '["agentic-ai","agents","ai"]',
      description: 'AutoGPT is the vision of accessible AI for everyone',
    }))).toEqual({ bucket: 'ai-ml', subType: 'ai-agent' })
  })
  it('classifies transferlearning (deep-learning)', () => {
    expect(classifyRepoBucket(makeRepo({
      name: 'transferlearning', topics: '["deep-learning","domain-adaptation"]',
      description: 'Transfer learning / domain adaptation',
    }))).toEqual({ bucket: 'ai-ml', subType: 'ai-model' })
  })
  it('classifies tldraw (design tool via canvas topic)', () => {
    expect(classifyRepoBucket(makeRepo({
      name: 'tldraw', topics: '["canvas","collaboration","design"]',
      description: 'very good whiteboard infinite canvas SDK',
    }))).toEqual({ bucket: 'editors', subType: 'design-tool' })
  })
  it('classifies daisyui (UI library via component topic)', () => {
    expect(classifyRepoBucket(makeRepo({
      name: 'daisyui', topics: '["component","component-library","components"]',
      description: 'Tailwind CSS component library',
    }))).toEqual({ bucket: 'frameworks', subType: 'ui-library' })
  })
  it('classifies n8n (automation via automation topic)', () => {
    expect(classifyRepoBucket(makeRepo({
      name: 'n8n', topics: '["ai","apis","automation"]',
      description: 'Fair-code workflow automation platform',
    }))).toEqual({ bucket: 'ai-ml', subType: 'ai-model' })
  })
  it('classifies WTF-Solidity (blockchain)', () => {
    expect(classifyRepoBucket(makeRepo({
      name: 'WTF-Solidity', topics: '["airdrop","auction","blockchain"]',
      description: 'WTF Solidity tutorial',
    }))).toEqual({ bucket: 'infrastructure', subType: 'blockchain' })
  })
  it('classifies You-Dont-Know-JS (book)', () => {
    expect(classifyRepoBucket(makeRepo({
      name: 'You-Dont-Know-JS', topics: '["async","book","book-series"]',
      description: 'A book series on the JS language',
    }))).toEqual({ bucket: 'learning', subType: 'book' })
  })
  it('classifies penpot (design tool)', () => {
    expect(classifyRepoBucket(makeRepo({
      name: 'penpot', topics: '["clojure","clojurescript","design"]',
      description: 'Penpot: The open-source design tool for design and code collaboration',
    }))).toEqual({ bucket: 'editors', subType: 'design-tool' })
  })
  it('classifies stable-diffusion-webui (AI via ai topic)', () => {
    expect(classifyRepoBucket(makeRepo({
      name: 'stable-diffusion-webui', topics: '["ai","ai-art","deep-learning"]',
      description: 'Stable Diffusion web UI',
    }))).toEqual({ bucket: 'ai-ml', subType: 'ai-model' })
  })

  // ── Priority ──────────────────────────────────────────────────────

  it('topics take precedence over name', () => {
    const repo = makeRepo({ topics: '["docker"]', name: 'postgres-client' })
    expect(classifyRepoBucket(repo)).toEqual({ bucket: 'infrastructure', subType: 'container' })
  })

  it('ml-framework topic takes precedence over ai-model for pytorch + deep-learning', () => {
    const repo = makeRepo({ topics: '["pytorch", "deep-learning"]' })
    expect(classifyRepoBucket(repo)).toEqual({ bucket: 'ai-ml', subType: 'ml-framework' })
  })

  // ── Null / edge cases ─────────────────────────────────────────────

  it('returns null for repos with no matching signals', () => {
    expect(classifyRepoBucket(makeRepo({ name: 'random-project' }))).toBeNull()
  })
  it('handles malformed topics JSON gracefully', () => {
    expect(classifyRepoBucket(makeRepo({ topics: 'not-json', name: 'random-project' }))).toBeNull()
  })
  it('handles null description without throwing', () => {
    expect(classifyRepoBucket(makeRepo({ description: null, topics: '["cli"]' }))).toEqual({ bucket: 'utilities', subType: 'cli-tool' })
  })

  it('classifies pkg-manager by cargo topic', () => {
    const r = makeRepo({ topics: '["cargo"]' })
    expect(classifyRepoBucket(r)).toEqual({ bucket: 'dev-tools', subType: 'pkg-manager' })
  })

  it('classifies debugger by gdb topic', () => {
    const r = makeRepo({ topics: '["gdb"]' })
    expect(classifyRepoBucket(r)).toEqual({ bucket: 'dev-tools', subType: 'debugger' })
  })

  it('classifies networking by nginx topic', () => {
    const r = makeRepo({ topics: '["nginx"]' })
    expect(classifyRepoBucket(r)).toEqual({ bucket: 'infrastructure', subType: 'networking' })
  })
})

describe('classifyRepoType shim', () => {
  it('maps dev-tools bucket to tool', () => {
    expect(classifyRepoType(makeRepo({ topics: '["algorithm"]' }))).toBe('tool')
  })
  it('maps ai-ml bucket to framework', () => {
    expect(classifyRepoType(makeRepo({ topics: '["llm"]' }))).toBe('framework')
  })
  it('maps frameworks bucket to framework', () => {
    expect(classifyRepoType(makeRepo({ topics: '["react"]' }))).toBe('framework')
  })
  it('maps learning bucket to learning', () => {
    expect(classifyRepoType(makeRepo({ topics: '["book"]' }))).toBe('learning')
  })
  it('maps editors bucket to application', () => {
    expect(classifyRepoType(makeRepo({ topics: '["vscode"]' }))).toBe('application')
  })
  it('maps infrastructure bucket to tool', () => {
    expect(classifyRepoType(makeRepo({ topics: '["docker"]' }))).toBe('tool')
  })
  it('maps utilities bucket to tool', () => {
    expect(classifyRepoType(makeRepo({ topics: '["cli"]' }))).toBe('tool')
  })
  it('maps lang-projects bucket to framework', () => {
    expect(classifyRepoType(makeRepo({ topics: '["compiler"]' }))).toBe('framework')
  })
  it('returns other for null classification', () => {
    expect(classifyRepoType(makeRepo({ name: 'random-project' }))).toBe('other')
  })
  it('handles malformed topics gracefully', () => {
    expect(classifyRepoType(makeRepo({ topics: 'not-json', name: 'random-project' }))).toBe('other')
  })
})
