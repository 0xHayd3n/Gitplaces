import type { Repo } from '../types/repo'

// ── New core classifier ───────────────────────────────────────────

export function classifyRepoBucket(
  repo: { name: string; description: string | null; topics: string[] }
): { bucket: string; subType: string } | null {
  const topics: string[] = Array.isArray(repo.topics) ? repo.topics : []

  const name = repo.name.toLowerCase()
  const desc = (repo.description ?? '').toLowerCase()

  const hasTopic = (...kw: string[]) => topics.some(t => kw.includes(t))
  const nameHas  = (...kw: string[]) => kw.some(k => name.includes(k))
  const descHas  = (...kw: string[]) => kw.some(k => desc.includes(k))

  // ── Topics (highest priority) ────────────────────────────────────

  // AI & ML — new specific sub-types (before existing checks)
  if (hasTopic('mlops', 'mlflow', 'kubeflow', 'bentoml', 'model-serving',
               'model-deployment', 'weights-and-biases', 'wandb', 'ml-pipeline'))
    return { bucket: 'ai-ml', subType: 'mlops' }
  if (hasTopic('computer-vision', 'opencv', 'image-recognition', 'object-detection',
               'yolo', 'detectron', 'image-processing', 'image-segmentation', 'ocr'))
    return { bucket: 'ai-ml', subType: 'computer-vision' }
  if (hasTopic('nlp', 'natural-language-processing', 'spacy', 'nltk', 'tokenizer',
               'text-processing', 'sentiment-analysis', 'named-entity-recognition',
               'text-classification'))
    return { bucket: 'ai-ml', subType: 'nlp-tool' }
  if (hasTopic('vector-database', 'vector-db', 'rag', 'retrieval-augmented',
               'embeddings', 'chromadb', 'pinecone', 'weaviate', 'faiss', 'qdrant', 'milvus'))
    return { bucket: 'ai-ml', subType: 'vector-db' }
  if (hasTopic('ai-coding', 'code-assistant', 'copilot', 'code-generation',
               'code-completion', 'ai-code', 'cursor', 'aider', 'continue-dev'))
    return { bucket: 'ai-ml', subType: 'ai-coding' }

  // AI & ML — specific sub-types first, then general
  if (hasTopic('pytorch', 'tensorflow', 'keras', 'scikit-learn', 'jax', 'mxnet',
               'paddle', 'caffe', 'theano', 'ml-framework', 'deep-learning-framework'))
    return { bucket: 'ai-ml', subType: 'ml-framework' }
  if (hasTopic('dataset', 'benchmark', 'corpus', 'training-data'))
    return { bucket: 'ai-ml', subType: 'dataset' }
  if (hasTopic('neural-network', 'cnn', 'rnn', 'gan', 'diffusion-model',
               'autoencoder', 'attention-mechanism'))
    return { bucket: 'ai-ml', subType: 'neural-net' }
  if (hasTopic('ai-agent', 'agent', 'agents', 'langchain', 'agentic-ai'))
    return { bucket: 'ai-ml', subType: 'ai-agent' }
  if (hasTopic('prompt', 'prompt-engineering'))
    return { bucket: 'ai-ml', subType: 'prompt-lib' }
  if (hasTopic('machine-learning', 'deep-learning', 'llm', 'gpt', 'transformer',
               'language-model',
               'stable-diffusion', 'bert', 'huggingface', 'openai', 'chatbot',
               'ai', 'artificial-intelligence', 'generative-ai'))
    return { bucket: 'ai-ml', subType: 'ai-model' }

  // Learning — new specific sub-types
  if (hasTopic('interview', 'interview-questions', 'interview-preparation', 'leetcode',
               'system-design', 'coding-interview', 'technical-interview', 'algo-practice'))
    return { bucket: 'learning', subType: 'interview-prep' }
  if (hasTopic('roadmap', 'developer-roadmap', 'learning-path', 'career-path', 'skill-tree'))
    return { bucket: 'learning', subType: 'roadmap' }
  if (hasTopic('coding-challenge', 'coding-challenges', 'advent-of-code', 'project-euler',
               'exercism', 'kata', 'competitive-programming', 'hackerrank', 'codewars'))
    return { bucket: 'learning', subType: 'coding-challenge' }
  if (hasTopic('research', 'paper', 'papers', 'papers-with-code', 'arxiv',
               'research-paper', 'paper-implementation', 'scientific-paper'))
    return { bucket: 'learning', subType: 'research-paper' }

  // Learning — books, tutorials, courses, awesome lists
  if (hasTopic('awesome-list', 'awesome', 'curated-list'))
    return { bucket: 'learning', subType: 'awesome-list' }
  if (hasTopic('book', 'book-series', 'ebook', 'free-programming-books'))
    return { bucket: 'learning', subType: 'book' }
  if (hasTopic('tutorial', 'tutorials', 'guide', 'learn', 'learning',
               'education', 'educational', 'workshop', 'hands-on'))
    return { bucket: 'learning', subType: 'tutorial' }
  if (hasTopic('course', 'mooc', 'curriculum', 'bootcamp'))
    return { bucket: 'learning', subType: 'course' }
  if (hasTopic('cheatsheet', 'cheat-sheet', 'reference', 'quick-reference'))
    return { bucket: 'learning', subType: 'cheatsheet' }

  // Frameworks — new specific sub-types
  if (hasTopic('electron', 'tauri', 'wails', 'pyqt', 'qt', 'gtk', 'wxwidgets',
               'desktop-app', 'desktop-application'))
    return { bucket: 'frameworks', subType: 'desktop-framework' }
  if (hasTopic('state-management', 'redux', 'zustand', 'mobx', 'pinia', 'jotai',
               'recoil', 'xstate', 'ngrx', 'vuex'))
    return { bucket: 'frameworks', subType: 'state-management' }
  if (hasTopic('data-visualization', 'visualization', 'charting', 'd3', 'chart',
               'plotly', 'recharts', 'echarts', 'grafana-plugin'))
    return { bucket: 'frameworks', subType: 'data-viz' }
  if (hasTopic('animation', 'motion', 'gsap', 'lottie', 'threejs', 'three-js',
               'webgl', '3d', 'framer-motion', 'anime'))
    return { bucket: 'frameworks', subType: 'animation' }
  if (hasTopic('passport', 'nextauth', 'lucia', 'supertokens', 'auth-library',
               'authentication-library', 'jwt', 'oauth2'))
    return { bucket: 'frameworks', subType: 'auth-library' }

  // Frameworks — web, CSS, UI, backend, mobile, game
  if (hasTopic('css-framework', 'css', 'tailwindcss', 'tailwind', 'bootstrap',
               'sass', 'less', 'postcss', 'styled-components'))
    return { bucket: 'frameworks', subType: 'css-framework' }
  if (hasTopic('component-library', 'ui-library', 'ui-components', 'design-system',
               'ui-kit', 'component', 'components', 'ui-framework'))
    return { bucket: 'frameworks', subType: 'ui-library' }
  if (hasTopic('react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxtjs', 'remix',
               'astro', 'solidjs', 'preact', 'lit', 'qwik', 'htmx'))
    return { bucket: 'frameworks', subType: 'web-framework' }
  if (hasTopic('express', 'django', 'flask', 'rails', 'spring', 'fastapi',
               'laravel', 'nestjs', 'koa', 'gin', 'fiber', 'actix',
               'phoenix', 'rocket', 'hono'))
    return { bucket: 'frameworks', subType: 'backend-framework' }
  if (hasTopic('react-native', 'flutter', 'ionic', 'expo', 'swiftui',
               'kotlin-multiplatform', 'capacitor', 'xamarin', 'maui'))
    return { bucket: 'frameworks', subType: 'mobile-framework' }
  if (hasTopic('game-engine', 'unity', 'unreal', 'godot', 'pygame', 'phaser',
               'game-development', 'gamedev', 'bevy'))
    return { bucket: 'frameworks', subType: 'game-engine' }

  // Language Projects — new specific sub-types
  if (hasTopic('type-checker', 'type-checking', 'typechecker', 'mypy', 'flow',
               'type-system', 'type-inference'))
    return { bucket: 'lang-projects', subType: 'type-checker' }
  if (hasTopic('language-server', 'lsp', 'language-server-protocol', 'rust-analyzer',
               'gopls', 'typescript-language-server'))
    return { bucket: 'lang-projects', subType: 'lang-server' }
  if (hasTopic('repl', 'interactive', 'interactive-shell', 'ipython', 'read-eval-print'))
    return { bucket: 'lang-projects', subType: 'repl' }
  if (hasTopic('package-registry', 'registry', 'npm-registry', 'verdaccio',
               'crates-io', 'pypi', 'artifact-repository'))
    return { bucket: 'lang-projects', subType: 'pkg-registry' }

  // Language Projects
  if (hasTopic('compiler', 'llvm', 'gcc', 'clang', 'rustc', 'compilation'))
    return { bucket: 'lang-projects', subType: 'compiler' }
  if (hasTopic('transpiler', 'babel', 'swc', 'source-to-source'))
    return { bucket: 'lang-projects', subType: 'transpiler' }
  if (hasTopic('runtime', 'nodejs', 'deno', 'bun', 'wasm', 'webassembly', 'v8', 'jvm'))
    return { bucket: 'lang-projects', subType: 'runtime' }
  if (hasTopic('programming-language', 'language', 'interpreter', 'parser', 'lexer'))
    return { bucket: 'lang-projects', subType: 'lang-impl' }
  if (hasTopic('style-guide', 'coding-standards', 'best-practices', 'coding-conventions'))
    return { bucket: 'lang-projects', subType: 'style-guide' }

  // Editors — new specific sub-types
  if (hasTopic('database-client', 'database-gui', 'database-management', 'dbeaver',
               'pgadmin', 'sql-client', 'database-tool', 'db-management'))
    return { bucket: 'editors', subType: 'db-client' }
  if (hasTopic('rest-client', 'http-client', 'graphql-client',
               'hoppscotch', 'insomnia', 'bruno'))
    return { bucket: 'editors', subType: 'api-client-app' }
  if (hasTopic('diff', 'diff-tool', 'merge-tool', 'code-diff', 'file-comparison'))
    return { bucket: 'editors', subType: 'diff-tool' }
  if (hasTopic('file-manager', 'file-browser', 'file-explorer', 'terminal-file-manager'))
    return { bucket: 'editors', subType: 'file-manager' }

  // Editors
  if (hasTopic('vscode', 'neovim', 'vim', 'emacs', 'zed', 'helix'))
    return { bucket: 'editors', subType: 'code-editor' }
  if (hasTopic('ide', 'intellij', 'eclipse', 'xcode', 'android-studio'))
    return { bucket: 'editors', subType: 'ide' }
  if (hasTopic('terminal', 'shell', 'iterm', 'alacritty', 'wezterm'))
    return { bucket: 'editors', subType: 'terminal' }
  if (hasTopic('notebook', 'jupyter'))
    return { bucket: 'editors', subType: 'notebook' }
  if (hasTopic('text-editor', 'notepad', 'sublime', 'atom', 'textmate'))
    return { bucket: 'editors', subType: 'text-editor' }
  if (hasTopic('design', 'figma', 'sketch', 'design-tool', 'prototyping',
               'whiteboard', 'drawing', 'canvas'))
    return { bucket: 'editors', subType: 'design-tool' }

  // Dev Tools — new specific sub-types
  if (hasTopic('profiler', 'profiling', 'flamegraph', 'performance-profiling'))
    return { bucket: 'dev-tools', subType: 'profiler' }
  if (hasTopic('code-generator', 'scaffolding', 'codegen', 'openapi-generator', 'yeoman'))
    return { bucket: 'dev-tools', subType: 'code-generator' }
  if (hasTopic('documentation', 'docs', 'documentation-tool', 'sphinx', 'jsdoc',
               'typedoc', 'docusaurus', 'mkdocs'))
    return { bucket: 'dev-tools', subType: 'doc-tool' }
  if (hasTopic('static-analysis', 'sast', 'sonarqube', 'semgrep', 'codeql', 'code-quality'))
    return { bucket: 'dev-tools', subType: 'static-analysis' }
  if (hasTopic('api-tool', 'swagger', 'openapi', 'postman', 'api-design', 'api-testing'))
    return { bucket: 'dev-tools', subType: 'api-tool' }
  if (hasTopic('monorepo', 'turborepo', 'nx', 'lerna', 'workspaces'))
    return { bucket: 'dev-tools', subType: 'monorepo-tool' }

  // Dev Tools
  if (hasTopic('algorithm', 'data-structures'))
    return { bucket: 'dev-tools', subType: 'algorithm' }
  if (hasTopic('testing', 'jest', 'pytest', 'mocha', 'test-framework', 'vitest'))
    return { bucket: 'dev-tools', subType: 'testing' }
  if (hasTopic('linter', 'eslint', 'prettier', 'rubocop'))
    return { bucket: 'dev-tools', subType: 'linter' }
  if (hasTopic('formatter', 'autopep8'))
    return { bucket: 'dev-tools', subType: 'formatter' }
  if (hasTopic('build-tool', 'webpack', 'vite', 'rollup', 'cmake', 'gradle'))
    return { bucket: 'dev-tools', subType: 'build-tool' }
  if (hasTopic('pkg-manager', 'package-manager', 'npm', 'pip', 'cargo', 'homebrew'))
    return { bucket: 'dev-tools', subType: 'pkg-manager' }
  if (hasTopic('debugger', 'gdb', 'lldb'))
    return { bucket: 'dev-tools', subType: 'debugger' }
  if (hasTopic('git', 'vcs', 'svn', 'mercurial'))
    return { bucket: 'dev-tools', subType: 'vcs-tool' }

  // Infrastructure — new specific sub-types
  if (hasTopic('message-queue', 'message-broker', 'kafka', 'rabbitmq', 'nats', 'zeromq',
               'amqp', 'pub-sub', 'event-streaming', 'pulsar'))
    return { bucket: 'infrastructure', subType: 'message-queue' }
  if (hasTopic('ci-cd', 'ci', 'cd', 'continuous-integration', 'continuous-deployment',
               'github-actions', 'jenkins', 'drone', 'woodpecker', 'gitlab-ci', 'circleci'))
    return { bucket: 'infrastructure', subType: 'ci-cd' }
  if (hasTopic('search-engine', 'full-text-search', 'elasticsearch', 'meilisearch',
               'typesense', 'solr', 'opensearch', 'lucene', 'search-index'))
    return { bucket: 'infrastructure', subType: 'search-engine' }
  if (hasTopic('identity', 'identity-provider', 'idp', 'keycloak', 'authentik',
               'casdoor', 'zitadel', 'sso', 'single-sign-on', 'ldap', 'saml', 'oidc'))
    return { bucket: 'infrastructure', subType: 'auth-infra' }
  if (hasTopic('api-gateway', 'gateway', 'kong', 'traefik', 'apisix',
               'api-management', 'api-proxy'))
    return { bucket: 'infrastructure', subType: 'api-gateway' }
  if (hasTopic('logging', 'log', 'log-management', 'elk', 'loki', 'fluentd',
               'fluentbit', 'logstash', 'structured-logging', 'syslog'))
    return { bucket: 'infrastructure', subType: 'logging' }

  // Infrastructure
  if (hasTopic('docker', 'container'))
    return { bucket: 'infrastructure', subType: 'container' }
  if (hasTopic('kubernetes', 'helm', 'terraform', 'devops', 'ansible'))
    return { bucket: 'infrastructure', subType: 'devops' }
  if (hasTopic('aws', 'gcp', 'azure', 'cloud', 'serverless', 'lambda',
               'cloud-computing', 'cloud-native', 'heroku', 'vercel', 'netlify'))
    return { bucket: 'infrastructure', subType: 'cloud-platform' }
  if (hasTopic('database', 'postgres', 'mysql', 'sqlite', 'mongodb', 'redis'))
    return { bucket: 'infrastructure', subType: 'database' }
  if (hasTopic('monitoring', 'observability', 'prometheus', 'grafana', 'datadog'))
    return { bucket: 'infrastructure', subType: 'monitoring' }
  if (hasTopic('networking', 'proxy', 'load-balancer', 'nginx', 'caddy'))
    return { bucket: 'infrastructure', subType: 'networking' }
  if (hasTopic('blockchain', 'ethereum', 'solidity', 'web3', 'smart-contracts',
               'defi', 'crypto', 'cryptocurrency', 'nft', 'dapp'))
    return { bucket: 'infrastructure', subType: 'blockchain' }

  // Utilities — new specific sub-types
  if (hasTopic('scraper', 'web-scraper', 'crawler', 'web-crawler', 'scraping',
               'web-scraping', 'spider', 'crawlee', 'puppeteer', 'playwright', 'selenium'))
    return { bucket: 'utilities', subType: 'scraper' }
  if (hasTopic('file-converter', 'converter', 'conversion', 'ffmpeg', 'pandoc',
               'imagemagick', 'transcoding', 'media-converter', 'format-conversion'))
    return { bucket: 'utilities', subType: 'file-converter' }
  if (hasTopic('i18n', 'internationalization', 'localization', 'l10n', 'i18next',
               'formatjs', 'translation', 'multilingual', 'lingui'))
    return { bucket: 'utilities', subType: 'i18n' }
  if (hasTopic('config', 'configuration', 'dotenv', 'env', 'config-management',
               'cosmiconfig', 'hydra', 'viper', 'feature-flag', 'feature-flags'))
    return { bucket: 'utilities', subType: 'config-tool' }
  if (hasTopic('notification', 'notifications', 'push-notification', 'ntfy', 'gotify',
               'apprise', 'alert', 'push', 'web-push'))
    return { bucket: 'utilities', subType: 'notification' }

  // Utilities
  if (hasTopic('cli', 'command-line'))
    return { bucket: 'utilities', subType: 'cli-tool' }
  if (hasTopic('plugin', 'extension'))
    return { bucket: 'utilities', subType: 'plugin' }
  if (hasTopic('boilerplate', 'starter', 'template'))
    return { bucket: 'utilities', subType: 'boilerplate' }
  if (hasTopic('library', 'lib'))
    return { bucket: 'utilities', subType: 'library' }
  if (hasTopic('api-client', 'sdk'))
    return { bucket: 'utilities', subType: 'api-client' }
  if (hasTopic('platform', 'saas', 'self-hosted'))
    return { bucket: 'utilities', subType: 'platform' }
  if (hasTopic('automation', 'workflow', 'cron', 'scheduler', 'n8n', 'zapier'))
    return { bucket: 'utilities', subType: 'automation' }

  // ── Name signals ─────────────────────────────────────────────────
  // Order matters: specific tools/utilities before broad framework names,
  // since names like "eslint-plugin-react" contain both "eslint" and "react".

  // AI & ML — name
  if (nameHas('pytorch', 'tensorflow', 'keras', 'scikit-learn', 'jax'))
    return { bucket: 'ai-ml', subType: 'ml-framework' }
  // AI & ML — new name signals
  if (nameHas('mlflow', 'kubeflow', 'bentoml', 'wandb', 'mlops'))
    return { bucket: 'ai-ml', subType: 'mlops' }
  if (nameHas('opencv', 'yolo', 'detectron', 'tesseract', 'ocr'))
    return { bucket: 'ai-ml', subType: 'computer-vision' }
  if (nameHas('spacy', 'nltk', 'tokenizer', 'nlp'))
    return { bucket: 'ai-ml', subType: 'nlp-tool' }
  if (nameHas('chromadb', 'pinecone', 'weaviate', 'faiss', 'qdrant', 'milvus'))
    return { bucket: 'ai-ml', subType: 'vector-db' }
  if (nameHas('copilot', 'cursor', 'aider', 'codeium', 'tabby'))
    return { bucket: 'ai-ml', subType: 'ai-coding' }

  // Learning — name
  if (nameHas('interview', 'leetcode', 'system-design-primer'))
    return { bucket: 'learning', subType: 'interview-prep' }
  if (nameHas('roadmap'))
    return { bucket: 'learning', subType: 'roadmap' }
  if (nameHas('advent-of-code', 'exercism', 'euler', 'codewars', 'hackerrank'))
    return { bucket: 'learning', subType: 'coding-challenge' }
  if (nameHas('paper', 'arxiv', 'papers-with-code'))
    return { bucket: 'learning', subType: 'research-paper' }

  // Language Projects — new name signals
  if (nameHas('mypy', 'flow', 'pytype', 'type-checker', 'pyright'))
    return { bucket: 'lang-projects', subType: 'type-checker' }
  if (nameHas('rust-analyzer', 'gopls', 'lsp', 'language-server'))
    return { bucket: 'lang-projects', subType: 'lang-server' }
  if (nameHas('repl', 'ipython', 'irb'))
    return { bucket: 'lang-projects', subType: 'repl' }
  if (nameHas('verdaccio', 'registry', 'pypi'))
    return { bucket: 'lang-projects', subType: 'pkg-registry' }

  // Language Projects — name
  if (nameHas('compiler', 'llvm', 'gcc', 'clang'))
    return { bucket: 'lang-projects', subType: 'compiler' }
  if (nameHas('transpiler', 'babel', 'swc'))
    return { bucket: 'lang-projects', subType: 'transpiler' }
  if (nameHas('runtime', 'deno', 'bun'))
    return { bucket: 'lang-projects', subType: 'runtime' }

  // Editors — new name signals
  if (nameHas('dbeaver', 'pgadmin', 'tableplus', 'beekeeper', 'dbgate', 'sqltools'))
    return { bucket: 'editors', subType: 'db-client' }
  if (nameHas('hoppscotch', 'insomnia', 'bruno', 'httpie'))
    return { bucket: 'editors', subType: 'api-client-app' }
  if (nameHas('diff', 'meld', 'delta', 'difftastic'))
    return { bucket: 'editors', subType: 'diff-tool' }
  if (nameHas('ranger', 'nnn', 'yazi', 'mc', 'lf', 'broot'))
    return { bucket: 'editors', subType: 'file-manager' }

  // Editors — name
  if (nameHas('vscode', 'neovim', 'nvim', 'emacs', 'zed', 'helix', 'vim'))
    return { bucket: 'editors', subType: 'code-editor' }
  if (nameHas('intellij', 'eclipse', 'xcode', 'android-studio'))
    return { bucket: 'editors', subType: 'ide' }
  if (nameHas('terminal', 'iterm', 'alacritty', 'wezterm', 'kitty', 'shell'))
    return { bucket: 'editors', subType: 'terminal' }
  if (nameHas('notebook', 'jupyter'))
    return { bucket: 'editors', subType: 'notebook' }
  if (nameHas('notepad', 'sublime', 'textmate'))
    return { bucket: 'editors', subType: 'text-editor' }

  // Dev Tools — new name signals
  if (nameHas('profiler', 'flamegraph', 'py-spy'))
    return { bucket: 'dev-tools', subType: 'profiler' }
  if (nameHas('codegen', 'generator', 'yeoman', 'hygen', 'plop'))
    return { bucket: 'dev-tools', subType: 'code-generator' }
  if (nameHas('sphinx', 'typedoc', 'jsdoc', 'docusaurus', 'mkdocs', 'storybook'))
    return { bucket: 'dev-tools', subType: 'doc-tool' }
  if (nameHas('sonarqube', 'semgrep', 'codeql', 'static-analysis'))
    return { bucket: 'dev-tools', subType: 'static-analysis' }
  if (nameHas('swagger', 'openapi', 'postman'))
    return { bucket: 'dev-tools', subType: 'api-tool' }
  if (nameHas('monorepo', 'turborepo', 'lerna', 'nx'))
    return { bucket: 'dev-tools', subType: 'monorepo-tool' }

  // Dev Tools — name (before frameworks so "eslint-plugin-react" → linter, not web-framework)
  if (nameHas('eslint', 'prettier', 'rubocop', 'pylint', 'flake8', 'linter'))
    return { bucket: 'dev-tools', subType: 'linter' }
  if (nameHas('formatter', 'autopep8'))
    return { bucket: 'dev-tools', subType: 'formatter' }
  if (nameHas('build-tool', 'webpack', 'rollup', 'cmake', 'gradle', 'esbuild', 'parcel', 'vite'))
    return { bucket: 'dev-tools', subType: 'build-tool' }
  if (nameHas('pkg-manager', 'homebrew', 'cargo', 'pnpm', 'npm', 'pip'))
    return { bucket: 'dev-tools', subType: 'pkg-manager' }
  if (nameHas('debugger', 'gdb', 'lldb'))
    return { bucket: 'dev-tools', subType: 'debugger' }
  if (nameHas('vcs', 'svn', 'mercurial', 'git'))
    return { bucket: 'dev-tools', subType: 'vcs-tool' }

  // Infrastructure — new name signals
  if (nameHas('kafka', 'rabbitmq', 'nats', 'zeromq', 'pulsar', 'celery'))
    return { bucket: 'infrastructure', subType: 'message-queue' }
  if (nameHas('jenkins', 'drone', 'woodpecker', 'circleci', 'github-actions'))
    return { bucket: 'infrastructure', subType: 'ci-cd' }
  if (nameHas('elasticsearch', 'meilisearch', 'typesense', 'solr', 'opensearch', 'lunr'))
    return { bucket: 'infrastructure', subType: 'search-engine' }
  if (nameHas('keycloak', 'authentik', 'casdoor', 'zitadel', 'authelia'))
    return { bucket: 'infrastructure', subType: 'auth-infra' }
  if (nameHas('kong', 'traefik', 'apisix', 'tyk'))
    return { bucket: 'infrastructure', subType: 'api-gateway' }
  if (nameHas('loki', 'fluentd', 'fluentbit', 'logstash', 'graylog', 'vector'))
    return { bucket: 'infrastructure', subType: 'logging' }

  // Infrastructure — name
  if (nameHas('kubernetes', 'helm', 'terraform', 'ansible', 'devops'))
    return { bucket: 'infrastructure', subType: 'devops' }
  if (nameHas('aws', 'gcp', 'azure', 'cloud', 'serverless', 'heroku', 'vercel', 'netlify'))
    return { bucket: 'infrastructure', subType: 'cloud-platform' }
  if (nameHas('postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'database', 'sqlite'))
    return { bucket: 'infrastructure', subType: 'database' }
  if (nameHas('prometheus', 'grafana', 'datadog', 'monitoring', 'observability'))
    return { bucket: 'infrastructure', subType: 'monitoring' }
  if (nameHas('nginx', 'caddy', 'haproxy', 'networking', 'proxy', 'load-balancer'))
    return { bucket: 'infrastructure', subType: 'networking' }

  // Utilities — new name signals
  if (nameHas('scrapy', 'crawlee', 'scraper', 'crawler', 'colly', 'spider'))
    return { bucket: 'utilities', subType: 'scraper' }
  if (nameHas('ffmpeg', 'pandoc', 'imagemagick', 'converter'))
    return { bucket: 'utilities', subType: 'file-converter' }
  if (nameHas('i18next', 'formatjs', 'lingui', 'i18n', 'polyglot'))
    return { bucket: 'utilities', subType: 'i18n' }
  if (nameHas('dotenv', 'cosmiconfig', 'hydra', 'viper', 'config'))
    return { bucket: 'utilities', subType: 'config-tool' }
  if (nameHas('ntfy', 'gotify', 'apprise', 'pushover', 'notifo'))
    return { bucket: 'utilities', subType: 'notification' }

  // Utilities — name (before frameworks so "react-boilerplate" → boilerplate, not web-framework)
  if (nameHas('boilerplate', 'starter', 'template'))
    return { bucket: 'utilities', subType: 'boilerplate' }

  // Frameworks — new name signals
  if (nameHas('electron', 'tauri', 'wails', 'pyqt', 'gtk'))
    return { bucket: 'frameworks', subType: 'desktop-framework' }
  if (nameHas('redux', 'zustand', 'mobx', 'pinia', 'jotai', 'recoil', 'xstate'))
    return { bucket: 'frameworks', subType: 'state-management' }
  if (nameHas('d3', 'chart', 'plotly', 'recharts', 'echarts', 'nivo', 'visx'))
    return { bucket: 'frameworks', subType: 'data-viz' }
  if (nameHas('animation', 'gsap', 'lottie', 'three', 'framer-motion', 'anime'))
    return { bucket: 'frameworks', subType: 'animation' }
  if (nameHas('passport', 'nextauth', 'lucia', 'supertokens'))
    return { bucket: 'frameworks', subType: 'auth-library' }

  // Frameworks — name (last among name signals, since framework names are broad substrings)
  if (nameHas('tailwind', 'bootstrap', 'bulma', 'sass'))
    return { bucket: 'frameworks', subType: 'css-framework' }
  if (nameHas('express', 'django', 'flask', 'rails', 'spring', 'fastapi', 'laravel', 'nestjs'))
    return { bucket: 'frameworks', subType: 'backend-framework' }
  if (nameHas('flutter', 'react-native', 'ionic', 'expo'))
    return { bucket: 'frameworks', subType: 'mobile-framework' }
  if (nameHas('unity', 'unreal', 'godot', 'phaser'))
    return { bucket: 'frameworks', subType: 'game-engine' }
  if (nameHas('react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxtjs', 'astro', 'solidjs'))
    return { bucket: 'frameworks', subType: 'web-framework' }

  // ── Description signals ──────────────────────────────────────────

  // AI & ML — description
  // AI & ML — new description signals
  if (descHas('mlops', 'model serving', 'model deployment', 'ml pipeline', 'experiment tracking'))
    return { bucket: 'ai-ml', subType: 'mlops' }
  if (descHas('computer vision', 'object detection', 'image recognition', 'image processing', 'image segmentation'))
    return { bucket: 'ai-ml', subType: 'computer-vision' }
  if (descHas('natural language processing', 'text processing', 'nlp library', 'tokenizer', 'sentiment analysis'))
    return { bucket: 'ai-ml', subType: 'nlp-tool' }
  if (descHas('vector database', 'vector search', 'retrieval augmented', 'embedding store', 'similarity search'))
    return { bucket: 'ai-ml', subType: 'vector-db' }
  if (descHas('ai coding', 'code assistant', 'code completion', 'ai-powered coding'))
    return { bucket: 'ai-ml', subType: 'ai-coding' }
  if (descHas('ml framework', 'machine learning framework', 'deep learning framework'))
    return { bucket: 'ai-ml', subType: 'ml-framework' }
  if (descHas('dataset', 'training data', 'benchmark dataset'))
    return { bucket: 'ai-ml', subType: 'dataset' }
  if (descHas('machine learning', 'deep learning', 'neural network', 'large language model'))
    return { bucket: 'ai-ml', subType: 'ai-model' }

  // Dev Tools — description signals
  if (descHas('profiler', 'profiling tool', 'flame graph'))
    return { bucket: 'dev-tools', subType: 'profiler' }
  if (descHas('code generator', 'scaffolding tool', 'generates code'))
    return { bucket: 'dev-tools', subType: 'code-generator' }
  if (descHas('documentation tool', 'documentation generator', 'api documentation'))
    return { bucket: 'dev-tools', subType: 'doc-tool' }
  if (descHas('static analysis', 'code quality', 'security scanning'))
    return { bucket: 'dev-tools', subType: 'static-analysis' }
  if (descHas('api tool', 'api testing', 'api design', 'api documentation'))
    return { bucket: 'dev-tools', subType: 'api-tool' }
  if (descHas('monorepo', 'workspace management'))
    return { bucket: 'dev-tools', subType: 'monorepo-tool' }

  // Frameworks — new description signals
  if (descHas('desktop framework', 'desktop application', 'cross-platform desktop'))
    return { bucket: 'frameworks', subType: 'desktop-framework' }
  if (descHas('state management', 'state library', 'global state'))
    return { bucket: 'frameworks', subType: 'state-management' }
  if (descHas('data visualization', 'charting library', 'chart library', 'interactive chart'))
    return { bucket: 'frameworks', subType: 'data-viz' }
  if (descHas('animation library', 'motion library', '3d rendering', 'webgl'))
    return { bucket: 'frameworks', subType: 'animation' }
  if (descHas('authentication library', 'auth library', 'login system', 'oauth library'))
    return { bucket: 'frameworks', subType: 'auth-library' }

  // Frameworks — description
  if (descHas('css framework', 'css library', 'tailwind'))
    return { bucket: 'frameworks', subType: 'css-framework' }
  if (descHas('component library', 'ui library', 'ui component', 'design system', 'component system'))
    return { bucket: 'frameworks', subType: 'ui-library' }
  if (descHas('web framework', 'frontend framework', 'front-end framework'))
    return { bucket: 'frameworks', subType: 'web-framework' }
  if (descHas('backend framework', 'server framework', 'api framework', 'web server'))
    return { bucket: 'frameworks', subType: 'backend-framework' }
  if (descHas('mobile framework', 'cross-platform mobile'))
    return { bucket: 'frameworks', subType: 'mobile-framework' }
  if (descHas('game engine', 'game framework', 'game development'))
    return { bucket: 'frameworks', subType: 'game-engine' }

  // Learning — new description signals
  if (descHas('interview preparation', 'interview questions', 'coding interview', 'system design interview'))
    return { bucket: 'learning', subType: 'interview-prep' }
  if (descHas('developer roadmap', 'learning path', 'learning roadmap', 'career path'))
    return { bucket: 'learning', subType: 'roadmap' }
  if (descHas('coding challenge', 'coding exercise', 'practice problems', 'competitive programming'))
    return { bucket: 'learning', subType: 'coding-challenge' }
  if (descHas('research paper', 'paper implementation', 'academic paper', 'arxiv paper'))
    return { bucket: 'learning', subType: 'research-paper' }

  // Learning — description
  if (descHas('awesome list', 'curated list of'))
    return { bucket: 'learning', subType: 'awesome-list' }
  if (descHas('book series', 'book about', 'free book'))
    return { bucket: 'learning', subType: 'book' }
  if (descHas('tutorial', 'learn how', 'course', 'teaching', 'multi-module course'))
    return { bucket: 'learning', subType: 'tutorial' }
  if (descHas('cheatsheet', 'cheat sheet', 'quick reference'))
    return { bucket: 'learning', subType: 'cheatsheet' }

  // Language Projects — new description signals
  if (descHas('type checker', 'type checking', 'type system', 'type inference'))
    return { bucket: 'lang-projects', subType: 'type-checker' }
  if (descHas('language server', 'lsp implementation', 'language server protocol', 'code intelligence'))
    return { bucket: 'lang-projects', subType: 'lang-server' }
  if (descHas('repl', 'interactive shell', 'read-eval-print', 'interactive console'))
    return { bucket: 'lang-projects', subType: 'repl' }
  if (descHas('package registry', 'private registry', 'artifact repository', 'package repository'))
    return { bucket: 'lang-projects', subType: 'pkg-registry' }

  // Language Projects — description
  if (descHas('compiler', 'compilation'))
    return { bucket: 'lang-projects', subType: 'compiler' }
  if (descHas('transpiler', 'source-to-source'))
    return { bucket: 'lang-projects', subType: 'transpiler' }
  if (descHas('runtime', 'javascript runtime', 'language runtime'))
    return { bucket: 'lang-projects', subType: 'runtime' }
  if (descHas('programming language', 'interpreter'))
    return { bucket: 'lang-projects', subType: 'lang-impl' }
  if (descHas('style guide', 'coding standard', 'coding convention'))
    return { bucket: 'lang-projects', subType: 'style-guide' }

  // Editors — new description signals
  if (descHas('database client', 'database gui', 'database management tool', 'sql client', 'database browser'))
    return { bucket: 'editors', subType: 'db-client' }
  if (descHas('rest client', 'http client', 'api testing tool'))
    return { bucket: 'editors', subType: 'api-client-app' }
  if (descHas('diff tool', 'merge tool', 'file comparison', 'code diff'))
    return { bucket: 'editors', subType: 'diff-tool' }
  if (descHas('file manager', 'file browser', 'file explorer', 'directory browser'))
    return { bucket: 'editors', subType: 'file-manager' }

  // Editors — description
  if (descHas('design tool', 'design and code', 'whiteboard', 'infinite canvas'))
    return { bucket: 'editors', subType: 'design-tool' }

  // Infrastructure — new description signals
  if (descHas('message queue', 'message broker', 'event streaming', 'pub/sub', 'async messaging'))
    return { bucket: 'infrastructure', subType: 'message-queue' }
  if (descHas('ci/cd', 'continuous integration', 'continuous deployment', 'build pipeline', 'deployment pipeline'))
    return { bucket: 'infrastructure', subType: 'ci-cd' }
  if (descHas('search engine', 'full-text search', 'search index', 'search server'))
    return { bucket: 'infrastructure', subType: 'search-engine' }
  if (descHas('identity provider', 'identity management', 'single sign-on', 'authentication server', 'identity platform'))
    return { bucket: 'infrastructure', subType: 'auth-infra' }
  if (descHas('api gateway', 'api management', 'api proxy', 'gateway service'))
    return { bucket: 'infrastructure', subType: 'api-gateway' }
  if (descHas('logging', 'log management', 'log aggregation', 'structured logging', 'log collector'))
    return { bucket: 'infrastructure', subType: 'logging' }

  // Infrastructure — description
  if (descHas('docker', 'containerized', 'container'))
    return { bucket: 'infrastructure', subType: 'container' }
  if (descHas('cloud platform', 'cloud service', 'serverless'))
    return { bucket: 'infrastructure', subType: 'cloud-platform' }
  if (descHas('database', 'sql database', 'nosql'))
    return { bucket: 'infrastructure', subType: 'database' }
  if (descHas('blockchain', 'smart contract', 'web3', 'decentralized'))
    return { bucket: 'infrastructure', subType: 'blockchain' }

  // Utilities — new description signals
  if (descHas('web scraper', 'web crawler', 'scraping tool', 'data scraping', 'site crawler'))
    return { bucket: 'utilities', subType: 'scraper' }
  if (descHas('file converter', 'format converter', 'media converter', 'transcoding tool', 'file conversion'))
    return { bucket: 'utilities', subType: 'file-converter' }
  if (descHas('internationalization', 'localization', 'i18n library', 'translation tool', 'multilingual'))
    return { bucket: 'utilities', subType: 'i18n' }
  if (descHas('configuration tool', 'config management', 'environment variables', 'feature flags', 'configuration library'))
    return { bucket: 'utilities', subType: 'config-tool' }
  if (descHas('notification service', 'push notification', 'notification tool', 'alert service'))
    return { bucket: 'utilities', subType: 'notification' }

  // Utilities — description
  if (descHas('command-line tool', 'cli tool', 'command line interface'))
    return { bucket: 'utilities', subType: 'cli-tool' }
  if (descHas('automation', 'workflow automation', 'automate'))
    return { bucket: 'utilities', subType: 'automation' }

  return null
}

// ── Backward-compatible shim ─────────────────────────────────────
// All existing callers (RepoCard, RepoListRow, BannerSVG, RepoDetail,
// REPO_TYPE_CONFIG) continue to work with zero changes.

export type RepoType =
  | 'awesome-list'
  | 'learning'
  | 'framework'
  | 'tool'
  | 'application'
  | 'other'

export const BUCKET_TO_LEGACY: Record<string, RepoType> = {
  'dev-tools':      'tool',
  'frameworks':     'framework',
  'ai-ml':          'framework',
  'learning':       'learning',
  'editors':        'application',
  'lang-projects':  'framework',
  'infrastructure': 'tool',
  'utilities':      'tool',
}

export function classifyRepoType(
  repo: Pick<Repo, 'name' | 'description' | 'topics'>
): RepoType {
  const result = classifyRepoBucket(repo)
  return result ? (BUCKET_TO_LEGACY[result.bucket] ?? 'other') : 'other'
}
