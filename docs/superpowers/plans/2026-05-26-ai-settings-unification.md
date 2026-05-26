# AI Settings Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the "Providers" and "Claude Code & OpenCode" Settings tabs into a single "AI" tab with five collapsible, transport-grouped sections and a standardized card format.

**Architecture:** Pure UI refactor in the renderer. Extract two new panels (`AIPanel`, `ConnectorsPanel`) plus three shared components (`SectionBlock`, `ProviderCard`, `AIIcon`) out of the 1867-line `Settings.tsx`. The shell `Settings.tsx` keeps the sidebar + a switch over `activeCategory`. No IPC, storage, or LLM-adapter changes.

**Tech Stack:** React 18 + TypeScript + Vitest + @testing-library/react + Vite. Icons via `~icons/simple-icons/...` (unplugin-icons). CSS in `src/styles/globals.css`.

**Spec:** [docs/superpowers/specs/2026-05-26-ai-settings-unification-design.md](../specs/2026-05-26-ai-settings-unification-design.md)

---

## File Structure

**Create:**
- `src/views/settings/AIPanel.tsx` — the new AI tab; owns all 5 sections + the state they need
- `src/views/settings/ConnectorsPanel.tsx` — slim Connectors tab (GitHub + Skills Backup)
- `src/views/settings/shared/SectionBlock.tsx` — collapsible section wrapper
- `src/views/settings/shared/ProviderCard.tsx` — standardized AI-item card
- `src/views/settings/shared/AIIcon.tsx` — brain icon for the sidebar
- `src/views/settings/shared/SectionBlock.test.tsx` — TDD coverage
- `src/views/settings/shared/ProviderCard.test.tsx` — TDD coverage

**Modify:**
- `src/views/Settings.tsx` — drop `renderProviders`, `renderClaudeOpenCode`, `renderConnectors`, the `CategoryId` enum entries `'providers'` and `'claude-opencode'`, the AI/connector-related state and handlers, and the `ProvidersIcon` + `DesktopIcon`. Add the `'ai'` `CategoryId` and route `<AIPanel />` / `<ConnectorsPanel />`. Default `activeCategory` flips to `'ai'`.
- `src/styles/globals.css` — add chip CSS vars + section-header rules.
- `src/views/Settings.test.tsx` — replace `"Claude Desktop section"` tests with the new IA + smoke tests for cards and section toggling.

**Untouched:**
- All `electron/` code, all `window.api.*` IPC surfaces, `apiStore`, `electron/llm/`, `agentFileSyncService`, `skillSync`, the existing `DefaultsSection` component logic (it gets lifted into `AIPanel` unchanged).

---

## Task 1: CSS foundations — chip vars and section-header styles

**Files:**
- Modify: `src/styles/globals.css` (root palette block ~line 55; settings styles further down)

Adds the CSS the chips and section headers will reference. Doing this first means component tasks don't have to invent class names.

- [ ] **Step 1: Add chip CSS vars to the existing `:root` palette block**

Open `src/styles/globals.css`. After the existing `--accent-hover` line (~line 60), add:

```css
  /* Transport chip palette */
  --chip-api-bg:   var(--accent-soft);
  --chip-api-text: var(--accent-text);
  --chip-cli-bg:   rgba(74, 222, 128, 0.15);
  --chip-cli-text: #86efac;
  --chip-mcp-bg:   rgba(74, 157, 209, 0.18);
  --chip-mcp-text: #93c5fd;
  --chip-beta-bg:  rgba(255, 180, 80, 0.15);
  --chip-beta-text:#f0c890;
```

- [ ] **Step 2: Add chip + section-block rules at the bottom of `globals.css`**

Append to `src/styles/globals.css`:

```css
/* === Settings AI panel — chips and sections === */

.transport-chip {
  display: inline-flex;
  align-items: center;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 1.5px 7px;
  border-radius: 9px;
  flex-shrink: 0;
}
.transport-chip.api  { background: var(--chip-api-bg);  color: var(--chip-api-text); }
.transport-chip.cli  { background: var(--chip-cli-bg);  color: var(--chip-cli-text); }
.transport-chip.mcp  { background: var(--chip-mcp-bg);  color: var(--chip-mcp-text); }
.transport-chip.beta { background: var(--chip-beta-bg); color: var(--chip-beta-text); }

.section-block {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 9px;
  margin-bottom: 12px;
  overflow: hidden;
}
.section-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 16px;
  cursor: pointer;
  user-select: none;
  background: none;
  border: none;
  color: inherit;
  width: 100%;
  text-align: left;
  font: inherit;
}
.section-block-header:hover { background: rgba(255,255,255,0.025); }
.section-block-title-row { display: flex; align-items: center; gap: 10px; }
.section-block-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.85);
}
.section-block-count {
  font-size: 10px;
  background: rgba(255,255,255,0.07);
  padding: 1px 7px;
  border-radius: 9px;
  color: rgba(255,255,255,0.55);
}
.section-block-chevron {
  opacity: 0.5;
  font-size: 11px;
  transition: transform 0.15s;
}
.section-block-chevron.expanded { transform: rotate(90deg); }
.section-block-body {
  padding: 0 14px 12px 14px;
  border-top: 1px solid rgba(255,255,255,0.04);
}
.section-block-body-desc {
  font-size: 11.5px;
  opacity: 0.5;
  padding: 8px 0 10px 0;
  font-style: italic;
}
```

- [ ] **Step 3: Build the renderer to confirm no CSS parse error**

Run: `npm run build`
Expected: `vite build` completes without errors. If the build script doesn't exist, run `npx tsc --noEmit` and `npm test -- --run` instead.

- [ ] **Step 4: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat(settings): add chip + section-block CSS for AI panel refactor"
```

---

## Task 2: SectionBlock component (TDD)

**Files:**
- Create: `src/views/settings/shared/SectionBlock.tsx`
- Test: `src/views/settings/shared/SectionBlock.test.tsx`

Collapsible section wrapper used by every AIPanel section.

- [ ] **Step 1: Write the failing test**

Create `src/views/settings/shared/SectionBlock.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import SectionBlock from './SectionBlock'

describe('SectionBlock', () => {
  it('renders the title in uppercase track', () => {
    render(
      <SectionBlock title="API / HTTPS">
        <div>body</div>
      </SectionBlock>,
    )
    expect(screen.getByText('API / HTTPS')).toBeInTheDocument()
  })

  it('renders the count pill when count is provided', () => {
    render(
      <SectionBlock title="API / HTTPS" count={4}>
        <div>body</div>
      </SectionBlock>,
    )
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('renders BETA badge when badge="BETA"', () => {
    render(
      <SectionBlock title="Custom MCP" badge="BETA">
        <div>body</div>
      </SectionBlock>,
    )
    expect(screen.getByText('BETA')).toBeInTheDocument()
  })

  it('renders body by default (defaultExpanded defaults to true)', () => {
    render(
      <SectionBlock title="API / HTTPS">
        <div data-testid="body">body content</div>
      </SectionBlock>,
    )
    expect(screen.getByTestId('body')).toBeInTheDocument()
  })

  it('does NOT render body when defaultExpanded is false', () => {
    render(
      <SectionBlock title="MCP" defaultExpanded={false}>
        <div data-testid="body">body content</div>
      </SectionBlock>,
    )
    expect(screen.queryByTestId('body')).not.toBeInTheDocument()
  })

  it('toggles body visibility when header is clicked', () => {
    render(
      <SectionBlock title="MCP" defaultExpanded={false}>
        <div data-testid="body">body content</div>
      </SectionBlock>,
    )
    expect(screen.queryByTestId('body')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('MCP'))
    expect(screen.getByTestId('body')).toBeInTheDocument()
    fireEvent.click(screen.getByText('MCP'))
    expect(screen.queryByTestId('body')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/views/settings/shared/SectionBlock.test.tsx`
Expected: FAIL — cannot resolve `./SectionBlock`.

- [ ] **Step 3: Create the component**

Create `src/views/settings/shared/SectionBlock.tsx`:

```tsx
import { useState, type ReactNode } from 'react'

export type SectionBlockProps = {
  title: string
  count?: number
  badge?: 'BETA'
  defaultExpanded?: boolean
  children: ReactNode
}

export default function SectionBlock({
  title,
  count,
  badge,
  defaultExpanded = true,
  children,
}: SectionBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="section-block">
      <button
        type="button"
        className="section-block-header"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <div className="section-block-title-row">
          <span className="section-block-title">{title}</span>
          {count !== undefined && (
            <span className="section-block-count">{count}</span>
          )}
          {badge === 'BETA' && (
            <span className="transport-chip beta">BETA</span>
          )}
        </div>
        <span className={`section-block-chevron${expanded ? ' expanded' : ''}`}>▸</span>
      </button>
      {expanded && (
        <div className="section-block-body">{children}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/views/settings/shared/SectionBlock.test.tsx`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/views/settings/shared/SectionBlock.tsx src/views/settings/shared/SectionBlock.test.tsx
git commit -m "feat(settings): add collapsible SectionBlock component"
```

---

## Task 3: ProviderCard component (TDD)

**Files:**
- Create: `src/views/settings/shared/ProviderCard.tsx`
- Test: `src/views/settings/shared/ProviderCard.test.tsx`

Standardized layout for every AI item card.

- [ ] **Step 1: Write the failing test**

Create `src/views/settings/shared/ProviderCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ProviderCard from './ProviderCard'

describe('ProviderCard', () => {
  it('renders the icon, name, chip and description', () => {
    render(
      <ProviderCard
        icon={<span data-testid="icon">I</span>}
        name="Anthropic"
        chip="API"
        description="Claude Opus, Sonnet, Haiku."
      />,
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('API')).toBeInTheDocument()
    expect(screen.getByText('Claude Opus, Sonnet, Haiku.')).toBeInTheDocument()
  })

  it('renders the status text with the correct tone class', () => {
    const { container } = render(
      <ProviderCard
        icon={<span>I</span>}
        name="Anthropic"
        chip="API"
        description="desc"
        status={{ tone: 'green', text: 'Connected' }}
      />,
    )
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(container.querySelector('.status-dot.green')).toBeTruthy()
  })

  it('renders children (e.g. an input) inside the card', () => {
    render(
      <ProviderCard
        icon={<span>I</span>}
        name="Anthropic"
        chip="API"
        description="desc"
      >
        <input data-testid="api-key-input" />
      </ProviderCard>,
    )
    expect(screen.getByTestId('api-key-input')).toBeInTheDocument()
  })

  it('renders actions when provided', () => {
    render(
      <ProviderCard
        icon={<span>I</span>}
        name="Anthropic"
        chip="API"
        description="desc"
        actions={<button>Test</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument()
  })

  it('applies the correct chip class for CLI', () => {
    const { container } = render(
      <ProviderCard
        icon={<span>I</span>}
        name="OpenCode"
        chip="CLI"
        description="desc"
      />,
    )
    expect(container.querySelector('.transport-chip.cli')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/views/settings/shared/ProviderCard.test.tsx`
Expected: FAIL — cannot resolve `./ProviderCard`.

- [ ] **Step 3: Create the component**

Create `src/views/settings/shared/ProviderCard.tsx`:

```tsx
import type { ReactNode } from 'react'

export type StatusTone = 'green' | 'amber' | 'red' | 'gray'

export type ProviderCardProps = {
  icon: ReactNode
  name: string
  chip: 'API' | 'CLI' | 'MCP'
  description: string
  status?: { tone: StatusTone; text: string }
  children?: ReactNode
  actions?: ReactNode
}

export default function ProviderCard({
  icon,
  name,
  chip,
  description,
  status,
  children,
  actions,
}: ProviderCardProps) {
  return (
    <div className="connector-row provider-card">
      <div className="connector-icon">{icon}</div>
      <div className="connector-info" style={{ flex: 1 }}>
        <div className="connector-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {name}
          <span className={`transport-chip ${chip.toLowerCase()}`}>{chip}</span>
        </div>
        <div className="connector-desc" style={{ marginTop: 2 }}>{description}</div>
        {children && <div style={{ marginTop: 8 }}>{children}</div>}
        {status && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, opacity: 0.75 }}>
            <span className={`status-dot ${status.tone}`} />
            {status.text}
          </div>
        )}
      </div>
      {actions && <div className="connector-actions">{actions}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Add `.status-dot` tone variants to `globals.css`**

In `src/styles/globals.css`, search for the existing `.status-dot` rule. If it does not have tone variants (`.green`, `.amber`, `.red`, `.gray`), append:

```css
.status-dot.green { background: #4ade80; }
.status-dot.amber { background: #f59e0b; }
.status-dot.red   { background: #ef4444; }
.status-dot.gray  { background: #6b7280; }
```

If `.status-dot` does not exist at all, also add:

```css
.status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run src/views/settings/shared/ProviderCard.test.tsx`
Expected: PASS — all 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/views/settings/shared/ProviderCard.tsx src/views/settings/shared/ProviderCard.test.tsx src/styles/globals.css
git commit -m "feat(settings): add standardized ProviderCard component"
```

---

## Task 4: AIIcon sidebar icon

**Files:**
- Create: `src/views/settings/shared/AIIcon.tsx`

Small brain SVG matching the style of the other sidebar icons in `Settings.tsx`.

- [ ] **Step 1: Create the icon**

Create `src/views/settings/shared/AIIcon.tsx`:

```tsx
export default function AIIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.5 2.5C4.1 2.5 3 3.6 3 5c0 .5.1 1 .4 1.4-.6.5-1 1.3-1 2.1 0 1.1.6 2 1.5 2.5-.1.2-.1.5-.1.8 0 1.4 1.1 2.5 2.5 2.5.7 0 1.3-.3 1.7-.7" />
      <path d="M10.5 2.5C11.9 2.5 13 3.6 13 5c0 .5-.1 1-.4 1.4.6.5 1 1.3 1 2.1 0 1.1-.6 2-1.5 2.5.1.2.1.5.1.8 0 1.4-1.1 2.5-2.5 2.5-.7 0-1.3-.3-1.7-.7" />
      <path d="M8 3v10 M5 6.5h1 M10 6.5h1 M5 9.5h1 M10 9.5h1" />
    </svg>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add src/views/settings/shared/AIIcon.tsx
git commit -m "feat(settings): add AIIcon brain icon for sidebar"
```

---

## Task 5: AIPanel scaffolding — empty sections

**Files:**
- Create: `src/views/settings/AIPanel.tsx`

A skeleton AIPanel that renders five empty `SectionBlock` placeholders. Behaviors and state are added in later tasks. This task is non-TDD because the body is just composition; a smoke test lands with Task 12.

- [ ] **Step 1: Create the file**

Create `src/views/settings/AIPanel.tsx`:

```tsx
import SectionBlock from './shared/SectionBlock'

export default function AIPanel() {
  return (
    <>
      <SectionBlock title="API / HTTPS" defaultExpanded>
        <div style={{ opacity: 0.5, fontSize: 12 }}>API providers coming in Task 6.</div>
      </SectionBlock>

      <SectionBlock title="CLI" defaultExpanded>
        <div style={{ opacity: 0.5, fontSize: 12 }}>CLI providers coming in Task 7.</div>
      </SectionBlock>

      <SectionBlock title="MCP" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>MCP exposure coming in Task 8.</div>
      </SectionBlock>

      <SectionBlock title="Custom MCP" badge="BETA" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>Custom MCP coming in Task 9.</div>
      </SectionBlock>

      <SectionBlock title="Defaults" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>Defaults coming in Task 10.</div>
      </SectionBlock>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/settings/AIPanel.tsx
git commit -m "feat(settings): add AIPanel scaffold with 5 empty sections"
```

---

## Task 6: AIPanel — API / HTTPS section

**Files:**
- Modify: `src/views/settings/AIPanel.tsx`

Populates the API section: four cards (Anthropic, OpenAI, Google Gemini, Local) and the existing `testProvider` / `renderStatus` logic lifted from `Settings.tsx:893-1047`.

- [ ] **Step 1: Lift the provider state and load effect**

Open the current `src/views/Settings.tsx` and copy the following — they will move into `AIPanel`:

- Imports: `IconAnthropic`, `IconOpenAI`, `IconGemini`, `IconOllama` (`Settings.tsx:5-8`)
- Type aliases: `ProviderConfig`, `OpenAICompatibleEndpoint`, `DefaultRef` (`Settings.tsx:16-18`)
- Constants: `KNOWN_MODELS_BY_PROVIDER`, `PROVIDER_INFO_TOOLTIP`, `InfoIcon` (`Settings.tsx:23-50`, `130-144`)
- The `OpenAICompatibleSection` helper component (`Settings.tsx:157-235`)
- Provider state hooks (`Settings.tsx:477-484`)
- The provider-config load `useEffect` (`Settings.tsx:506-530`)
- The `renderProviders` function's internal `saveProvider`, `testProvider`, `renderStatus` (`Settings.tsx:894-910`)
- The four provider-card JSX blocks (`Settings.tsx:919-1000`)
- The `OpenAICompatibleSection` invocation (`Settings.tsx:1000`)

- [ ] **Step 2: Replace the AIPanel file with the API-section implementation**

Open `src/views/settings/AIPanel.tsx` and replace its contents with:

```tsx
import { useState, useEffect, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import SectionBlock from './shared/SectionBlock'
import ProviderCard from './shared/ProviderCard'
import IconAnthropic from '~icons/simple-icons/anthropic'
import IconOpenAI from '~icons/simple-icons/openai'
import IconGemini from '~icons/simple-icons/googlegemini'
import IconOllama from '~icons/simple-icons/ollama'

type ProviderConfig = { enabled: boolean; apiKey?: string; organization?: string }
type OpenAICompatibleEndpoint = { id: string; label: string; baseUrl: string; apiKey?: string }

const KNOWN_MODELS_BY_PROVIDER: Record<'anthropic' | 'openai' | 'google', { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7 (1M context)' },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4o',       label: 'GPT-4o' },
    { id: 'gpt-4o-mini',  label: 'GPT-4o mini' },
    { id: 'gpt-4.1',      label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    { id: 'o3-mini',      label: 'o3-mini' },
  ],
  google: [
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  ],
}

const PROVIDER_INFO_TOOLTIP: Record<string, string> = {
  anthropic: 'Includes:\n• ' + KNOWN_MODELS_BY_PROVIDER.anthropic.map(m => m.label).join('\n• '),
  openai:    'Includes:\n• ' + KNOWN_MODELS_BY_PROVIDER.openai.map(m => m.label).join('\n• '),
  google:    'Includes:\n• ' + KNOWN_MODELS_BY_PROVIDER.google.map(m => m.label).join('\n• '),
  'openai-compatible': 'Run any OpenAI-compatible API:\n• Ollama\n• LM Studio\n• llama.cpp\n• Custom self-hosted endpoints',
}

const InfoIcon = ({ title }: { title: string }) => (
  <span
    title={title}
    style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 6, opacity: 0.55, cursor: 'help', flexShrink: 0 }}
  >
    <svg
      width={12} height={12} viewBox="0 0 12 12" fill="none"
      stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="5" />
      <path d="M6 5.4v3" />
      <circle cx="6" cy="3.6" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  </span>
)

function OpenAICompatibleSection(props: {
  endpoints: OpenAICompatibleEndpoint[]
  setEndpoints: Dispatch<SetStateAction<OpenAICompatibleEndpoint[]>>
  testProvider: (provider: string, modelHint: string) => Promise<void>
  renderStatus: (provider: string) => ReactNode
}) {
  const [adding, setAdding] = useState(false)
  const [newId,    setNewId]    = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newUrl,   setNewUrl]   = useState('')
  const [newKey,   setNewKey]   = useState('')

  const submitAdd = async () => {
    if (!newId.trim() || !newLabel.trim() || !newUrl.trim()) return
    const ep = { id: newId.trim(), label: newLabel.trim(), baseUrl: newUrl.trim(), apiKey: newKey.trim() || undefined }
    await window.api.llm.upsertOpenAICompatibleEndpoint(ep)
    const fresh = await window.api.llm.listOpenAICompatibleEndpoints()
    props.setEndpoints(fresh)
    setAdding(false)
    setNewId(''); setNewLabel(''); setNewUrl(''); setNewKey('')
  }

  const removeEp = async (id: string) => {
    await window.api.llm.removeOpenAICompatibleEndpoint(id)
    const fresh = await window.api.llm.listOpenAICompatibleEndpoints()
    props.setEndpoints(fresh)
  }

  return (
    <ProviderCard
      icon={<IconOllama width={20} height={20} style={{ color: 'var(--text)' }} />}
      name="Local / OpenAI-compatible"
      chip="API"
      description="Ollama, LM Studio, llama.cpp, or any OpenAI-compatible endpoint."
      actions={<button className="settings-btn" onClick={() => setAdding(true)}>Add endpoint</button>}
    >
      <InfoIcon title={PROVIDER_INFO_TOOLTIP['openai-compatible']} />

      {props.endpoints.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {props.endpoints.map(ep => (
            <div key={ep.id} className="connector-row" style={{ marginTop: 6 }}>
              <div className="connector-info" style={{ flex: 1 }}>
                <div className="connector-name">{ep.label}</div>
                <div className="connector-desc">{ep.baseUrl} <span style={{ opacity: 0.6 }}>(id: {ep.id})</span></div>
              </div>
              <div className="connector-actions">
                <button className="settings-btn" onClick={() => props.testProvider(`openai-compatible:${ep.id}`, 'gpt-3.5-turbo')}>Test</button>
                {props.renderStatus(`openai-compatible:${ep.id}`)}
                <button className="settings-btn settings-btn--link" onClick={() => removeEp(ep.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="connector-add-modal" style={{ marginTop: 10 }}>
          <div className="connector-modal-header"><strong>Add openai-compatible endpoint</strong></div>
          <div className="connector-modal-fields" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="settings-input" placeholder="id (slug, e.g. ollama-local)" value={newId}    onChange={e => setNewId(e.target.value)} />
            <input className="settings-input" placeholder="Display label"                value={newLabel} onChange={e => setNewLabel(e.target.value)} />
            <input className="settings-input" placeholder="Base URL (e.g. http://localhost:11434/v1)" value={newUrl} onChange={e => setNewUrl(e.target.value)} />
            <input className="settings-input" type="password" placeholder="API key (optional, leave blank for local)" value={newKey} onChange={e => setNewKey(e.target.value)} />
          </div>
          <div className="connector-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="settings-btn settings-btn--ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button className="settings-btn" onClick={submitAdd}>Add</button>
          </div>
        </div>
      )}
    </ProviderCard>
  )
}

export default function AIPanel() {
  // Providers state
  const [anthropicCfg, setAnthropicCfg] = useState<ProviderConfig>({ enabled: false })
  const [openaiCfg,    setOpenaiCfg]    = useState<ProviderConfig>({ enabled: false })
  const [googleCfg,    setGoogleCfg]    = useState<ProviderConfig>({ enabled: false })
  const [endpoints,    setEndpoints]    = useState<OpenAICompatibleEndpoint[]>([])
  const [testStatus,   setTestStatus]   = useState<Record<string, { ok: boolean; message?: string } | 'testing'>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const api = window.api.llm
      const [a, o, g, eps] = await Promise.all([
        api.getProviderConfig('anthropic'),
        api.getProviderConfig('openai'),
        api.getProviderConfig('google'),
        api.listOpenAICompatibleEndpoints(),
      ])
      if (cancelled) return
      setAnthropicCfg(a)
      setOpenaiCfg(o)
      setGoogleCfg(g)
      setEndpoints(eps)
    })().catch(err => console.error('[AIPanel] failed to load provider configs:', err))
    return () => { cancelled = true }
  }, [])

  const saveProvider = async (provider: 'anthropic' | 'openai' | 'google', cfg: ProviderConfig) => {
    await window.api.llm.setProviderConfig(provider, cfg)
  }

  const testProvider = async (provider: string, modelHint: string) => {
    setTestStatus(s => ({ ...s, [provider]: 'testing' }))
    const result = await window.api.llm.testConnection({ provider, model: modelHint })
    setTestStatus(s => ({ ...s, [provider]: { ok: result.ok, message: result.ok ? `OK: ${result.sample ?? ''}` : `${result.kind}: ${result.message}` } }))
  }

  const renderStatus = (provider: string): ReactNode => {
    const s = testStatus[provider]
    if (s === 'testing') return <span className="connector-badge">Testing…</span>
    if (!s) return null
    if (s.ok) return <span className="connector-badge connected">{s.message}</span>
    return <span className="connector-badge" style={{ background: 'var(--accent-red-soft, #fee2e2)', color: 'var(--accent-red, #991b1b)' }}>{s.message}</span>
  }

  const apiCount = 4

  return (
    <>
      <SectionBlock title="API / HTTPS" count={apiCount} defaultExpanded>
        <div className="section-block-body-desc">Git Suite calls these models directly using your API key.</div>

        <ProviderCard
          icon={<IconAnthropic width={20} height={20} style={{ color: 'var(--text)' }} />}
          name="Anthropic"
          chip="API"
          description="Claude Opus, Sonnet, Haiku."
          actions={<>
            <button className="settings-btn" disabled={!anthropicCfg.apiKey} onClick={() => testProvider('anthropic', 'claude-haiku-4-5-20251001')}>Test</button>
            {renderStatus('anthropic')}
          </>}
        >
          <input
            className="settings-input"
            type="password"
            placeholder="sk-ant-..."
            value={anthropicCfg.apiKey ?? ''}
            onChange={e => setAnthropicCfg({ ...anthropicCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
            onBlur={() => saveProvider('anthropic', anthropicCfg)}
            style={{ width: '100%' }}
          />
        </ProviderCard>

        <ProviderCard
          icon={<IconOpenAI width={20} height={20} style={{ color: 'var(--text)' }} />}
          name="OpenAI"
          chip="API"
          description="GPT-4o, GPT-4.1, o3-mini."
          actions={<>
            <button className="settings-btn" disabled={!openaiCfg.apiKey} onClick={() => testProvider('openai', 'gpt-4o')}>Test</button>
            {renderStatus('openai')}
          </>}
        >
          <input
            className="settings-input"
            type="password"
            placeholder="sk-..."
            value={openaiCfg.apiKey ?? ''}
            onChange={e => setOpenaiCfg({ ...openaiCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
            onBlur={() => saveProvider('openai', openaiCfg)}
            style={{ width: '100%' }}
          />
          <input
            className="settings-input"
            type="text"
            placeholder="Organization ID (optional)"
            value={openaiCfg.organization ?? ''}
            onChange={e => setOpenaiCfg({ ...openaiCfg, organization: e.target.value || undefined })}
            onBlur={() => saveProvider('openai', openaiCfg)}
            style={{ marginTop: 4, width: '100%' }}
          />
        </ProviderCard>

        <ProviderCard
          icon={<IconGemini width={20} height={20} style={{ color: 'var(--text)' }} />}
          name="Google Gemini"
          chip="API"
          description="Gemini 2.5 Pro, Flash; Gemini 1.5."
          actions={<>
            <button className="settings-btn" disabled={!googleCfg.apiKey} onClick={() => testProvider('google', 'gemini-2.5-pro')}>Test</button>
            {renderStatus('google')}
          </>}
        >
          <input
            className="settings-input"
            type="password"
            placeholder="g-..."
            value={googleCfg.apiKey ?? ''}
            onChange={e => setGoogleCfg({ ...googleCfg, apiKey: e.target.value, enabled: e.target.value.length > 0 })}
            onBlur={() => saveProvider('google', googleCfg)}
            style={{ width: '100%' }}
          />
        </ProviderCard>

        <OpenAICompatibleSection
          endpoints={endpoints}
          setEndpoints={setEndpoints}
          testProvider={testProvider}
          renderStatus={renderStatus}
        />
      </SectionBlock>

      <SectionBlock title="CLI" defaultExpanded>
        <div style={{ opacity: 0.5, fontSize: 12 }}>CLI providers coming in Task 7.</div>
      </SectionBlock>

      <SectionBlock title="MCP" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>MCP exposure coming in Task 8.</div>
      </SectionBlock>

      <SectionBlock title="Custom MCP" badge="BETA" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>Custom MCP coming in Task 9.</div>
      </SectionBlock>

      <SectionBlock title="Defaults" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>Defaults coming in Task 10.</div>
      </SectionBlock>
    </>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/settings/AIPanel.tsx
git commit -m "feat(settings): wire up API / HTTPS section in AIPanel"
```

---

## Task 7: AIPanel — CLI section (Claude Code + OpenCode)

**Files:**
- Modify: `src/views/settings/AIPanel.tsx`

Populates the CLI section: two cards (Anthropic's Claude Code, OpenCode) with their install/login state, handlers, and inline progress logs.

- [ ] **Step 1: Lift the existing CLI state and handlers from `Settings.tsx`**

You'll need the following blocks from `src/views/Settings.tsx`:

- `SetupPhase` and `LoginPhase` type aliases (lines 10-11)
- Claude Code state hooks (`claudeCodeInstalled`, `claudeCodeLoggedIn`, `setupPhase`, `setupLines`, `loginPhase`, `loginLines`, `claudeLoggingOut`, `claudeDisconnectError`) — lines 438-456 and 603-605
- OpenCode state hooks (`opencodeInstalled`, `opencodeLoggedIn`, `opencodeSetupPhase`, `opencodeSetupLines`, `opencodeLoginPhase`, `opencodeLoginLines`) — lines 625-630
- `timers` ref + cleanup (`Settings.tsx:632-633`)
- `useEffect` that calls `window.api.skill.detectClaudeCode` etc. (`Settings.tsx:645-675`) — extract only the Claude Code + OpenCode parts; leave the unrelated calls (`download.getDefaultFolder`, `tts.getVoices`, etc.) in Settings.tsx
- Handlers: `handleSetup`, `handleLogin`, `handleClaudeDisconnect` (lines 738-756, 758-782, 835-846)
- Handlers: `handleOpencodeSetup`, `handleOpencodeLogin`, `handleOpencodeLogout` (lines 1405-1451)

- [ ] **Step 2: Add the new imports at the top of `AIPanel.tsx`**

In `src/views/settings/AIPanel.tsx`, add to the imports block:

```tsx
import { useCallback, useRef } from 'react'
import IconClaude from '~icons/simple-icons/claude'
```

(Ensure `useState`, `useEffect`, `type ReactNode`, `type Dispatch`, `type SetStateAction` are still imported. Add `useCallback`, `useRef` to the existing `react` import line.)

- [ ] **Step 3: Add types and OpenCode SVG icon helper at module scope**

Above `function OpenAICompatibleSection`, add:

```tsx
type SetupPhase = 'idle' | 'checking' | 'installing' | 'auth' | 'done' | 'error'
type LoginPhase = 'idle' | 'logging-in' | 'done' | 'error'

const OpenCodeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text)' }} aria-hidden="true">
    <polyline points="8 6 2 12 8 18" />
    <polyline points="16 6 22 12 16 18" />
  </svg>
)
```

- [ ] **Step 4: Add state, refs, effect, and handlers inside `AIPanel`**

Inside the `AIPanel` function body, right after the existing provider state hooks, add:

```tsx
  // Claude Code state
  const [claudeCodeInstalled, setClaudeCodeInstalled] = useState<boolean | null>(null)
  const [claudeCodeLoggedIn, setClaudeCodeLoggedIn]   = useState<boolean | null>(null)
  const [setupPhase, setSetupPhase] = useState<SetupPhase>('idle')
  const [setupLines, setSetupLines] = useState<string[]>([])
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('idle')
  const [loginLines, setLoginLines] = useState<string[]>([])
  const [claudeLoggingOut, setClaudeLoggingOut] = useState(false)
  const [claudeDisconnectError, setClaudeDisconnectError] = useState<string | null>(null)

  // OpenCode state
  const [opencodeInstalled, setOpencodeInstalled] = useState<boolean | null>(null)
  const [opencodeLoggedIn, setOpencodeLoggedIn]   = useState<boolean | null>(null)
  const [opencodeSetupPhase, setOpencodeSetupPhase] = useState<SetupPhase>('idle')
  const [opencodeSetupLines, setOpencodeSetupLines] = useState<string[]>([])
  const [opencodeLoginPhase, setOpencodeLoginPhase] = useState<LoginPhase>('idle')
  const [opencodeLoginLines, setOpencodeLoginLines] = useState<string[]>([])

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  useEffect(() => {
    window.api.skill.detectClaudeCode().then(installed => {
      setClaudeCodeInstalled(installed)
      if (installed) window.api.skill.checkAuthStatus().then(setClaudeCodeLoggedIn)
      else setClaudeCodeLoggedIn(false)
    })
    window.api.opencode.detect().then(setOpencodeInstalled).catch(() => setOpencodeInstalled(false))
    window.api.opencode.checkAuthStatus().then(setOpencodeLoggedIn).catch(() => setOpencodeLoggedIn(false))
  }, [])

  const handleSetup = useCallback(async () => {
    setSetupPhase('checking')
    setSetupLines([])
    const onProgress = ({ phase, message }: { phase: string; message: string }) => {
      setSetupPhase(phase as SetupPhase)
      setSetupLines((prev) => [...prev, message])
    }
    window.api.skill.onSetupProgress(onProgress)
    try {
      await window.api.skill.setup()
      const installed = await window.api.skill.detectClaudeCode()
      setClaudeCodeInstalled(installed)
      if (installed) window.api.skill.checkAuthStatus().then(setClaudeCodeLoggedIn)
    } finally {
      window.api.skill.offSetupProgress(onProgress)
    }
  }, [])

  const handleLogin = useCallback(async () => {
    setLoginPhase('logging-in')
    setLoginLines([])
    let hadError = false
    const onProgress = ({ message, isError, done }: { message: string; isError?: boolean; done?: boolean }) => {
      setLoginLines((prev) => [...prev, message])
      if (isError) { hadError = true; setLoginPhase('error') }
      if (done) {
        setLoginPhase('done')
        window.api.skill.checkAuthStatus().then(setClaudeCodeLoggedIn)
      }
    }
    window.api.skill.onLoginProgress(onProgress)
    try {
      await window.api.skill.loginClaude()
      if (!hadError) setLoginPhase('done')
    } catch {
      setLoginPhase('error')
    } finally {
      window.api.skill.offLoginProgress(onProgress)
    }
  }, [])

  const handleClaudeDisconnect = async () => {
    setClaudeLoggingOut(true)
    setClaudeDisconnectError(null)
    try {
      await window.api.skill.logoutClaude()
      setClaudeCodeLoggedIn(false)
    } catch {
      setClaudeDisconnectError('Logout failed — please try again.')
    } finally {
      setClaudeLoggingOut(false)
    }
  }

  const handleOpencodeSetup = async () => {
    setOpencodeSetupPhase('installing')
    setOpencodeSetupLines([])
    const cb = (payload: { phase: string; line?: string }) => {
      if (payload.line) setOpencodeSetupLines(prev => [...prev, payload.line!])
      if (payload.phase === 'done') setOpencodeSetupPhase('done')
      if (payload.phase === 'error') setOpencodeSetupPhase('error')
    }
    window.api.opencode.onSetupProgress(cb)
    try {
      const result = await window.api.opencode.setup()
      if (result.ok) {
        setOpencodeInstalled(true)
        setOpencodeSetupPhase('done')
      } else {
        setOpencodeSetupPhase('error')
      }
    } finally {
      window.api.opencode.offSetupProgress(cb)
    }
  }

  const handleOpencodeLogin = async () => {
    setOpencodeLoginPhase('logging-in')
    setOpencodeLoginLines([])
    const cb = (payload: { message: string; isError?: boolean; done?: boolean }) => {
      setOpencodeLoginLines(prev => [...prev, payload.message])
      if (payload.done) setOpencodeLoginPhase(payload.isError ? 'error' : 'done')
    }
    window.api.opencode.onLoginProgress(cb)
    try {
      const result = await window.api.opencode.loginOpenCode()
      if (result.ok) {
        setOpencodeLoggedIn(true)
        setOpencodeLoginPhase('done')
      } else if (opencodeLoginPhase !== 'error') {
        setOpencodeLoginPhase('error')
      }
    } finally {
      window.api.opencode.offLoginProgress(cb)
    }
  }

  const handleOpencodeLogout = async () => {
    await window.api.opencode.logoutOpenCode()
    setOpencodeLoggedIn(false)
  }
```

- [ ] **Step 5: Replace the placeholder CLI `SectionBlock` body**

Find the existing placeholder:

```tsx
      <SectionBlock title="CLI" defaultExpanded>
        <div style={{ opacity: 0.5, fontSize: 12 }}>CLI providers coming in Task 7.</div>
      </SectionBlock>
```

Replace it with:

```tsx
      <SectionBlock title="CLI" count={2} defaultExpanded>
        <div className="section-block-body-desc">
          Git Suite spawns the CLI tool and talks to it via stdio. Uses your subscription.
        </div>

        <ProviderCard
          icon={<IconClaude width={20} height={20} style={{ color: 'var(--text)' }} />}
          name="Anthropic's Claude Code"
          chip="CLI"
          description="Anthropic's CLI agent. Runs Claude via your Claude.ai subscription."
          status={
            claudeCodeLoggedIn === true
              ? { tone: 'green', text: 'Installed · Logged in' }
              : claudeCodeInstalled === false
                ? { tone: 'gray', text: 'Not installed' }
                : { tone: 'amber', text: 'Installed · Not logged in' }
          }
          actions={
            (setupPhase !== 'idle' && setupPhase !== 'done') || loginPhase === 'logging-in' ? (
              <span className="connector-status-text">
                {setupPhase !== 'idle' && setupPhase !== 'done' ? 'Installing…' : 'Connecting…'}
              </span>
            ) : claudeCodeLoggedIn === true ? (
              <button
                className="settings-btn settings-btn--link connector-disconnect-btn"
                disabled={claudeLoggingOut}
                onClick={handleClaudeDisconnect}
              >
                {claudeLoggingOut ? 'Logging out…' : 'Disconnect'}
              </button>
            ) : claudeCodeInstalled === false && setupPhase === 'idle' ? (
              <button className="settings-btn" onClick={handleSetup}>Install</button>
            ) : claudeCodeLoggedIn === false && loginPhase === 'idle' ? (
              <button className="settings-btn" onClick={handleLogin}>Connect</button>
            ) : (
              <span className="connector-status-text">Checking…</span>
            )
          }
        />

        {claudeDisconnectError && (
          <p className="settings-hint error" style={{ margin: '4px 0' }}>{claudeDisconnectError}</p>
        )}

        {setupPhase !== 'idle' && setupPhase !== 'done' && (
          <div className="settings-setup-log" style={{ width: '100%', marginTop: 6 }}>
            {setupLines.map((line, i) => (
              <div key={i} className={`settings-setup-line${setupPhase === 'error' && i === setupLines.length - 1 ? ' error' : ''}`}>{line}</div>
            ))}
            {setupPhase !== 'error' && <div className="settings-setup-line muted">…</div>}
          </div>
        )}
        {setupPhase === 'done' && (
          <p className="settings-hint success">Claude installed and authenticated.</p>
        )}
        {loginPhase === 'logging-in' && (
          <div className="settings-setup-log" style={{ width: '100%', marginTop: 6 }}>
            {loginLines.map((line, i) => {
              const urlMatch = line.match(/(https:\/\/\S+)/)
              return (
                <div key={i} className="settings-setup-line">
                  {urlMatch ? (
                    <>
                      <span>{line.slice(0, urlMatch.index)}</span>
                      <a href="#" style={{ color: 'var(--accent)', wordBreak: 'break-all' }} onClick={e => { e.preventDefault(); window.api.openExternal(urlMatch[1]) }}>{urlMatch[1]}</a>
                      <span>{line.slice((urlMatch.index ?? 0) + urlMatch[1].length)}</span>
                    </>
                  ) : line}
                </div>
              )
            })}
            <div className="settings-setup-line muted">Waiting for browser login…</div>
          </div>
        )}
        {loginPhase === 'error' && (
          <div className="settings-setup-log" style={{ width: '100%', marginTop: 6 }}>
            {loginLines.map((line, i) => <div key={i} className={`settings-setup-line${i === loginLines.length - 1 ? ' error' : ''}`}>{line}</div>)}
            <div className="settings-inline-row" style={{ marginTop: 8 }}>
              <button className="settings-btn" onClick={() => { setLoginPhase('idle'); setLoginLines([]) }}>Try again</button>
            </div>
          </div>
        )}
        {loginPhase === 'done' && (
          <p className="settings-hint success">Logged in — skill generation now uses your Claude subscription.</p>
        )}

        <ProviderCard
          icon={<OpenCodeIcon />}
          name="OpenCode"
          chip="CLI"
          description="CLI fork supporting Claude, GPT, Gemini, and local models via one OAuth login."
          status={
            opencodeInstalled === null || opencodeLoggedIn === null
              ? { tone: 'gray', text: 'Checking…' }
              : opencodeInstalled && opencodeLoggedIn
                ? { tone: 'green', text: 'Installed · Logged in' }
                : opencodeInstalled
                  ? { tone: 'amber', text: 'Installed · Not logged in' }
                  : { tone: 'gray', text: 'Not installed' }
          }
          actions={
            opencodeInstalled === false ? (
              <button
                className="settings-btn"
                disabled={opencodeSetupPhase === 'installing' || opencodeSetupPhase === 'checking'}
                onClick={handleOpencodeSetup}
              >
                {opencodeSetupPhase === 'installing' || opencodeSetupPhase === 'checking' ? 'Installing…' : 'Install'}
              </button>
            ) : opencodeInstalled && opencodeLoggedIn === false ? (
              <button
                className="settings-btn"
                disabled={opencodeLoginPhase === 'logging-in'}
                onClick={handleOpencodeLogin}
              >
                {opencodeLoginPhase === 'logging-in' ? 'Waiting for browser…' : 'Login'}
              </button>
            ) : opencodeInstalled && opencodeLoggedIn ? (
              <button className="settings-btn settings-btn--link" onClick={handleOpencodeLogout}>
                Logout
              </button>
            ) : null
          }
        />

        {(opencodeSetupLines.length > 0 || opencodeLoginLines.length > 0) && (
          <div className="settings-setup-log" style={{ width: '100%', marginTop: 6 }}>
            {[...opencodeSetupLines, ...opencodeLoginLines].map((line, i) => (
              <div key={i} className="settings-setup-line">{line}</div>
            ))}
          </div>
        )}
      </SectionBlock>
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/views/settings/AIPanel.tsx
git commit -m "feat(settings): wire up CLI section (Claude Code + OpenCode) in AIPanel"
```

---

## Task 8: AIPanel — MCP section

**Files:**
- Modify: `src/views/settings/AIPanel.tsx`

Lifts the existing Claude Code MCP exposure block (`Settings.tsx:1455-1510`) into the MCP `SectionBlock`. Default-expanded when `mcpConfigured` is false (so users see it on first launch); collapsed once configured.

- [ ] **Step 1: Add MCP state and handlers inside `AIPanel`**

Inside the `AIPanel` function body, after the CLI state block, add:

```tsx
  // MCP exposure state
  const [mcpConfigured, setMcpConfigured] = useState(false)
  const [mcpConfigPath, setMcpConfigPath] = useState<string | null>(null)
  const [mcpStatusLoaded, setMcpStatusLoaded] = useState(false)
  const [configSnippet, setConfigSnippet]   = useState('')
  const [copied, setCopied]                 = useState(false)
  const [autoConfigStatus, setAutoConfigStatus] = useState<string | null>(null)
  const [autoConfigIsError, setAutoConfigIsError] = useState(false)
  const [testResult, setTestResult]         = useState<string | null>(null)

  const loadMcpStatus = useCallback(async () => {
    const [status, snippet] = await Promise.all([
      window.api.mcp.getStatus(),
      window.api.mcp.getConfigSnippet(),
    ])
    setMcpConfigured(status.configured)
    setMcpConfigPath(status.configPath)
    setConfigSnippet(snippet)
    setMcpStatusLoaded(true)
  }, [])

  useEffect(() => { loadMcpStatus() }, [loadMcpStatus])

  const handleAutoConfigure = async () => {
    setAutoConfigStatus(null)
    const result = await window.api.mcp.autoConfigure()
    if (result.success) {
      setAutoConfigStatus('Configured!')
      setAutoConfigIsError(false)
      await loadMcpStatus()
    } else {
      setAutoConfigStatus(`Failed: ${result.error ?? 'unknown error'}`)
      setAutoConfigIsError(true)
    }
    timers.current.push(setTimeout(() => { setAutoConfigStatus(null); setAutoConfigIsError(false) }, 3000))
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(configSnippet)
    setCopied(true)
    timers.current.push(setTimeout(() => setCopied(false), 2000))
  }

  const handleTestConnection = async () => {
    setTestResult(null)
    const result = await window.api.mcp.testConnection()
    if (result.running) {
      setTestResult(`Running — ${result.skillCount} active skill${result.skillCount !== 1 ? 's' : ''}`)
    } else {
      setTestResult('Not running')
    }
    timers.current.push(setTimeout(() => setTestResult(null), 4000))
  }
```

- [ ] **Step 2: Replace the placeholder MCP `SectionBlock`**

Find and replace:

```tsx
      <SectionBlock title="MCP" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>MCP exposure coming in Task 8.</div>
      </SectionBlock>
```

With:

```tsx
      {mcpStatusLoaded && (
        <SectionBlock
          title="MCP"
          count={1}
          defaultExpanded={!mcpConfigured}
        >
          <div className="section-block-body-desc">
            Expose Git Suite's tools to Claude Code CLI via the Model Context Protocol.
          </div>

          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Status</div>
              <div className="settings-group-row-sub">
                <span className={`status-dot ${mcpConfigured ? 'active' : 'inactive'}`} />
                {mcpConfigured ? 'Configured' : 'Not configured'}
              </div>
            </div>
            <button className="settings-btn" onClick={handleAutoConfigure}>
              Auto-configure
            </button>
          </div>

          {mcpConfigPath && (
            <div className="settings-group-row settings-group-row--full">
              <p className="settings-hint settings-mcp-path">
                Config file: {mcpConfigPath}
              </p>
            </div>
          )}

          {autoConfigStatus && (
            <div className="settings-group-row settings-group-row--full">
              <p className={`settings-hint${autoConfigIsError ? ' error' : ' success'}`}>{autoConfigStatus}</p>
            </div>
          )}

          <div className="settings-group-row settings-group-row--full">
            <div className="settings-group-row-label">Manual configuration</div>
            <p className="settings-hint" style={{ marginTop: 4 }}>
              Add this to <code>claude_desktop_config.json</code>:
            </p>
            <div className="settings-mcp-snippet-row">
              <pre className="settings-mcp-snippet">{configSnippet}</pre>
              <button className="settings-btn settings-mcp-copy-btn" onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Test connection</div>
              <div className="settings-group-row-sub">
                {testResult ?? 'Verify the MCP server is reachable.'}
              </div>
            </div>
            <button className="settings-btn" onClick={handleTestConnection}>
              Test
            </button>
          </div>
        </SectionBlock>
      )}
```

(The `{mcpStatusLoaded &&` guard avoids the initial flash where `defaultExpanded` would compute against the un-loaded `mcpConfigured=false`.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/settings/AIPanel.tsx
git commit -m "feat(settings): wire up MCP exposure section in AIPanel"
```

---

## Task 9: AIPanel — Custom MCP section

**Files:**
- Modify: `src/views/settings/AIPanel.tsx`

Lifts the custom-connector list, add modal, and related handlers from `Settings.tsx:594-613, 815-891, 1293-1401`.

- [ ] **Step 1: Add Custom MCP state and handlers inside `AIPanel`**

Inside the `AIPanel` function body, after the MCP state block, add:

```tsx
  // Custom MCP state
  type CustomConnector = { id: string; name: string; url: string; oauthClientId: string; oauthClientSecret: string }
  const [connectorStatus, setConnectorStatus] = useState<Record<string, 'checking' | 'ok' | 'error'>>({})
  const [customConnectors, setCustomConnectors] = useState<CustomConnector[]>([])
  const [showAddConnector, setShowAddConnector] = useState(false)
  const [newConnectorName, setNewConnectorName] = useState('')
  const [newConnectorUrl, setNewConnectorUrl] = useState('')
  const [newConnectorAdvanced, setNewConnectorAdvanced] = useState(false)
  const [newConnectorOAuthId, setNewConnectorOAuthId] = useState('')
  const [newConnectorOAuthSecret, setNewConnectorOAuthSecret] = useState('')

  useEffect(() => {
    window.api.settings.get('customConnectors').then((raw: string | null) => {
      try { if (raw) setCustomConnectors(JSON.parse(raw)) } catch { /* ignore */ }
    })
  }, [])

  const saveCustomConnectors = async (list: CustomConnector[]) => {
    setCustomConnectors(list)
    await window.api.settings.set('customConnectors', JSON.stringify(list))
  }

  const testConnector = async (id: string, url: string) => {
    if (!url) return
    try { new URL(url) } catch { return }
    if (!url.startsWith('http://') && !url.startsWith('https://')) return
    setConnectorStatus(prev => ({ ...prev, [id]: 'checking' }))
    try {
      const result = await window.api.connectors.test(url)
      setConnectorStatus(prev => ({ ...prev, [id]: result.ok ? 'ok' : 'error' }))
    } catch {
      setConnectorStatus(prev => ({ ...prev, [id]: 'error' }))
    }
  }

  const resetAddForm = () => {
    setNewConnectorName('')
    setNewConnectorUrl('')
    setNewConnectorAdvanced(false)
    setNewConnectorOAuthId('')
    setNewConnectorOAuthSecret('')
    setShowAddConnector(false)
  }

  const handleAddConnector = async () => {
    if (!newConnectorName.trim()) return
    const connector: CustomConnector = {
      id: Date.now().toString(),
      name: newConnectorName.trim(),
      url: newConnectorUrl.trim(),
      oauthClientId: newConnectorOAuthId.trim(),
      oauthClientSecret: newConnectorOAuthSecret.trim(),
    }
    await saveCustomConnectors([...customConnectors, connector])
    resetAddForm()
    testConnector(connector.id, connector.url)
  }

  const handleRemoveConnector = async (id: string) => {
    await saveCustomConnectors(customConnectors.filter(c => c.id !== id))
    setConnectorStatus(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }
```

- [ ] **Step 2: Replace the placeholder Custom MCP `SectionBlock`**

Find and replace:

```tsx
      <SectionBlock title="Custom MCP" badge="BETA" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>Custom MCP coming in Task 9.</div>
      </SectionBlock>
```

With:

```tsx
      <SectionBlock title="Custom MCP" count={customConnectors.length} badge="BETA" defaultExpanded={false}>
        <div className="section-block-body-desc">
          Third-party MCP servers Git Suite can call as tool sources.
        </div>

        {customConnectors.map(c => (
          <div key={c.id} className="connector-row">
            <div className="connector-icon connector-icon--custom">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/>
              </svg>
            </div>
            <div className="connector-info">
              <div className="connector-name">{c.name}</div>
              {c.url && <div className="connector-desc">{c.url}</div>}
            </div>
            <div className="connector-actions">
              {connectorStatus[c.id] === 'checking' ? (
                <span className="connector-status-text">Checking…</span>
              ) : connectorStatus[c.id] === 'ok' ? (
                <span className="connector-badge connected">Connected</span>
              ) : connectorStatus[c.id] === 'error' ? (
                <span className="connector-badge error">Error</span>
              ) : null}
              <button
                className="settings-btn settings-btn--link connector-disconnect-btn"
                disabled={connectorStatus[c.id] === 'checking'}
                onClick={() => testConnector(c.id, c.url)}
              >
                Retest
              </button>
              <button
                className="settings-btn settings-btn--link connector-disconnect-btn"
                disabled={connectorStatus[c.id] === 'checking'}
                onClick={() => handleRemoveConnector(c.id)}
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        {showAddConnector ? (
          <div className="connector-add-modal" style={{ marginTop: 10 }}>
            <div className="connector-modal-header">
              <span className="connector-modal-title">Add custom connector</span>
              <span className="connector-modal-beta">BETA</span>
            </div>
            <p className="connector-modal-desc">
              Connect Git Suite to your data and tools via a remote MCP server.
            </p>
            <div className="connector-modal-fields">
              <input className="settings-input connector-modal-input" type="text" placeholder="Name" value={newConnectorName} onChange={e => setNewConnectorName(e.target.value)} autoFocus />
              <input className="settings-input connector-modal-input" type="url" placeholder="Remote MCP server URL" value={newConnectorUrl} onChange={e => setNewConnectorUrl(e.target.value)} />
            </div>
            <button className="connector-advanced-toggle" onClick={() => setNewConnectorAdvanced(v => !v)} type="button">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ transform: newConnectorAdvanced ? 'rotate(180deg)' : 'rotate(90deg)', transition: 'transform 0.15s' }}>
                <path d="M2 4l4 4 4-4"/>
              </svg>
              Advanced settings
            </button>
            {newConnectorAdvanced && (
              <div className="connector-modal-fields">
                <input className="settings-input connector-modal-input" type="text" placeholder="OAuth Client ID (optional)" value={newConnectorOAuthId} onChange={e => setNewConnectorOAuthId(e.target.value)} />
                <input className="settings-input connector-modal-input" type="password" placeholder="OAuth Client Secret (optional)" value={newConnectorOAuthSecret} onChange={e => setNewConnectorOAuthSecret(e.target.value)} />
              </div>
            )}
            <p className="connector-modal-warning">
              Only use connectors from developers you trust. Git Suite cannot verify that connectors will work as intended or that they won&rsquo;t change.
            </p>
            <div className="connector-modal-actions">
              <button className="settings-btn settings-btn--ghost" onClick={resetAddForm}>Cancel</button>
              <button className="settings-btn" onClick={handleAddConnector} disabled={!newConnectorName.trim()}>Add</button>
            </div>
          </div>
        ) : (
          <button className="connector-add-btn" onClick={() => setShowAddConnector(true)}>
            + Add custom connector
          </button>
        )}
      </SectionBlock>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/settings/AIPanel.tsx
git commit -m "feat(settings): wire up Custom MCP section in AIPanel"
```

---

## Task 10: AIPanel — Defaults section

**Files:**
- Modify: `src/views/settings/AIPanel.tsx`

Lifts the existing `DefaultsSection` component from `Settings.tsx:237-433` into a module-level helper inside `AIPanel.tsx`. Also lifts the `DefaultRef` type, defaults state, and defaults-load effect.

- [ ] **Step 1: Add the `DefaultRef` type and copy the `DefaultsSection` helper**

In `src/views/settings/AIPanel.tsx`, add `DefaultRef` to the type aliases block at module scope:

```tsx
type DefaultRef = { provider: string; model: string; endpoint?: string } | undefined
```

Then copy the entire `DefaultsSection` function from `Settings.tsx:237-433` (including its props type) and paste it at module scope inside `AIPanel.tsx`, just above the existing `OpenAICompatibleSection` helper. No changes to the body.

- [ ] **Step 2: Add defaults state and load effect inside `AIPanel`**

In the `AIPanel` function body, after the Custom MCP state, add:

```tsx
  const [chatDefault,  setChatDefault]  = useState<DefaultRef>(undefined)
  const [skillDefault, setSkillDefault] = useState<DefaultRef>(undefined)
  const [tagDefault,   setTagDefault]   = useState<DefaultRef>(undefined)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const api = window.api.llm
      const [cd, sd, td] = await Promise.all([
        api.getDefault('chat'),
        api.getDefault('skillGen'),
        api.getDefault('tagExtract'),
      ])
      if (cancelled) return
      setChatDefault(cd)
      setSkillDefault(sd)
      setTagDefault(td)
    })().catch(err => console.error('[AIPanel] failed to load defaults:', err))
    return () => { cancelled = true }
  }, [])
```

- [ ] **Step 3: Replace the placeholder Defaults `SectionBlock`**

Find and replace:

```tsx
      <SectionBlock title="Defaults" defaultExpanded={false}>
        <div style={{ opacity: 0.5, fontSize: 12 }}>Defaults coming in Task 10.</div>
      </SectionBlock>
```

With:

```tsx
      <SectionBlock title="Defaults" defaultExpanded={false}>
        <div className="section-block-body-desc">
          Which model is used for which feature. Works with any transport above.
        </div>
        <DefaultsSection
          chatDefault={chatDefault}   setChatDefault={setChatDefault}
          skillDefault={skillDefault} setSkillDefault={setSkillDefault}
          tagDefault={tagDefault}     setTagDefault={setTagDefault}
          anthropicConfigured={!!anthropicCfg.apiKey}
          openaiConfigured={!!openaiCfg.apiKey}
          googleConfigured={!!googleCfg.apiKey}
          endpoints={endpoints}
        />
      </SectionBlock>
```

(Note: `DefaultsSection` renders its own "Defaults" header with `.settings-group-title`. That's redundant inside the SectionBlock. Open `DefaultsSection` and delete the `<div className="settings-group-title">Defaults</div>` line — search for it inside the pasted helper.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/views/settings/AIPanel.tsx
git commit -m "feat(settings): wire up Defaults section in AIPanel"
```

---

## Task 11: ConnectorsPanel — slim GitHub + Skills Backup

**Files:**
- Create: `src/views/settings/ConnectorsPanel.tsx`

Lifts the GitHub and Skills Backup blocks from `Settings.tsx:1077-1191`. Drops the Claude subscription row (now in AI > CLI) and the custom-connector rows (now in AI > Custom MCP).

- [ ] **Step 1: Create the file**

Create `src/views/settings/ConnectorsPanel.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useGitHubAuth } from '../../contexts/GitHubAuth'
import { useGitHubLogin } from '../../hooks/useGitHubLogin'

export default function ConnectorsPanel() {
  const auth = useGitHubAuth()
  const githubLogin = useGitHubLogin()
  const githubUsername = auth.user?.login ?? null
  const githubConnecting = githubLogin.status === 'pending' || githubLogin.status === 'polling'
  const githubUserCode = githubLogin.userCode
  const githubVerificationUri = githubLogin.verificationUri
  const githubVerificationUriComplete = githubLogin.verificationUriComplete
  const githubError = githubLogin.error
  const [githubDisconnecting, setGithubDisconnecting] = useState(false)

  const [syncStatus, setSyncStatus] = useState<{
    enabled: boolean
    repoOwner: string | undefined
    failedCount: number
    lastSynced: number | null
  } | null>(null)
  const [syncConnecting, setSyncConnecting] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false)

  useEffect(() => {
    window.api.skillSync.getStatus().then(setSyncStatus)
  }, [])

  useEffect(() => {
    const onFailed = () => { window.api.skillSync.getStatus().then(setSyncStatus) }
    window.api.skillSync.onSyncFailed(onFailed)
    return () => window.api.skillSync.offSyncFailed(onFailed)
  }, [])

  const handleSyncConnectClick = useCallback(() => { setSyncConfirmOpen(true) }, [])
  const handleSyncConfirm = useCallback(async () => {
    setSyncConfirmOpen(false)
    setSyncConnecting(true)
    setSyncError(null)
    const result = await window.api.skillSync.setup()
    setSyncConnecting(false)
    if (result.ok) {
      const status = await window.api.skillSync.getStatus()
      setSyncStatus(status)
    } else {
      setSyncError(result.error)
    }
  }, [])
  const handleSyncDisconnect = useCallback(async () => {
    await window.api.skillSync.disconnect()
    const status = await window.api.skillSync.getStatus()
    setSyncStatus(status)
  }, [])
  const handleSyncRetry = useCallback(async () => {
    await window.api.skillSync.retryFailed()
    const status = await window.api.skillSync.getStatus()
    setSyncStatus(status)
  }, [])

  const handleGitHubConnect = () => { githubLogin.start() }
  const handleGitHubDisconnect = async () => {
    githubLogin.reset()
    setGithubDisconnecting(true)
    try {
      await window.api.github.disconnect()
      await auth.refresh()
    } finally {
      setGithubDisconnecting(false)
    }
  }

  return (
    <>
      {syncConfirmOpen && (
        <div className="coll-modal-overlay" onClick={() => setSyncConfirmOpen(false)}>
          <div className="coll-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="coll-modal-title">Connect Skills Backup</div>
            <p className="settings-hint" style={{ marginTop: 8, marginBottom: 16 }}>
              {syncStatus?.repoOwner
                ? <>Connect to your existing <strong>gitsuite-skills</strong> repo.</>
                : <>This will create a private repo <strong>gitsuite-skills</strong> on your GitHub account. Your skills will be pushed there automatically after each generation.</>}
            </p>
            <div className="coll-modal-actions">
              <button className="coll-modal-cancel" onClick={() => setSyncConfirmOpen(false)}>Cancel</button>
              <button className="coll-modal-create" onClick={handleSyncConfirm}>{syncStatus?.repoOwner ? 'Connect' : 'Create & Connect'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="connector-section-header">
        <p className="settings-hint" style={{ margin: 0, fontSize: 12.5, color: 'var(--t2)' }}>
          Connect external services Git Suite can read from.
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group-body connector-list">

          {/* GitHub */}
          <div className="connector-row">
            <div className="connector-icon connector-icon--github">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
              </svg>
            </div>
            <div className="connector-info">
              <div className="connector-name">GitHub</div>
              <div className="connector-desc">
                {githubUsername ? `Connected as @${githubUsername}` : 'Connect your GitHub account'}
              </div>
            </div>
            <div className="connector-actions">
              {githubConnecting ? (
                githubUserCode ? (
                  <div className="connector-device-flow">
                    <span className="connector-code">{githubUserCode}</span>
                    <button className="settings-btn" onClick={() => {
                      const url = githubVerificationUriComplete ?? githubVerificationUri
                      if (url) window.api.github.openLoginPopup(url).catch(() => {})
                    }}>
                      Open login window
                    </button>
                    <button className="settings-btn settings-btn--link" onClick={() => githubLogin.cancel()}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <span className="connector-status-text">Connecting…</span>
                )
              ) : githubUsername ? (
                <>
                  <span className="connector-badge connected">Connected</span>
                  <button
                    className="settings-btn settings-btn--link connector-disconnect-btn"
                    disabled={githubDisconnecting}
                    onClick={handleGitHubDisconnect}
                  >
                    {githubDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </>
              ) : (
                <button className="settings-btn" onClick={handleGitHubConnect}>Connect</button>
              )}
            </div>
          </div>

          {githubError && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint error" style={{ margin: 0 }}>{githubError}</p>
            </div>
          )}

          {/* Skills Backup */}
          <div className="connector-row">
            <div className="connector-icon connector-icon--skills-backup">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 16 12 12 8 16" />
                <line x1="12" y1="12" x2="12" y2="21" />
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
              </svg>
            </div>
            <div className="connector-info">
              <div className="connector-name">Skills Backup</div>
              <div className="connector-desc">
                {syncStatus?.enabled
                  ? syncStatus.failedCount > 0
                    ? 'Last sync failed.'
                    : syncStatus.lastSynced
                      ? <>
                          <a href="#" onClick={e => { e.preventDefault(); void window.api.openExternal(`https://github.com/${syncStatus.repoOwner}/gitsuite-skills`) }}>
                            {syncStatus.repoOwner}/gitsuite-skills
                          </a>
                          {' — '}Last synced {new Date(syncStatus.lastSynced).toLocaleString()}
                        </>
                      : <a href="#" onClick={e => { e.preventDefault(); void window.api.openExternal(`https://github.com/${syncStatus.repoOwner}/gitsuite-skills`) }}>
                          {syncStatus.repoOwner}/gitsuite-skills
                        </a>
                  : 'Back up your skills to GitHub'}
              </div>
            </div>
            <div className="connector-actions">
              {syncStatus?.enabled ? (
                syncStatus.failedCount > 0 ? (
                  <>
                    <button className="settings-btn" onClick={handleSyncRetry}>Retry</button>
                    <button className="settings-btn settings-btn--link connector-disconnect-btn" onClick={handleSyncDisconnect}>Disconnect</button>
                  </>
                ) : (
                  <button className="settings-btn settings-btn--link connector-disconnect-btn" onClick={handleSyncDisconnect}>Disconnect</button>
                )
              ) : syncConnecting ? (
                <span className="connector-status-text">Connecting…</span>
              ) : (
                <button
                  className="settings-btn"
                  onClick={handleSyncConnectClick}
                  disabled={!githubUsername}
                  title={!githubUsername ? 'Log in to GitHub first' : undefined}
                >
                  Connect
                </button>
              )}
            </div>
          </div>

          {syncError && (
            <div className="connector-row connector-row--log">
              <p className="settings-hint error" style={{ margin: 0 }}>{syncError}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/settings/ConnectorsPanel.tsx
git commit -m "feat(settings): add slim ConnectorsPanel (GitHub + Skills Backup only)"
```

---

## Task 12: Settings.tsx shell rewire — new IA and routing

**Files:**
- Modify: `src/views/Settings.tsx`

This is the biggest single edit. The Settings shell becomes a sidebar + a routing switch. All AI/Connector-related logic moves out. The other tabs (Appearance, Language, Downloads, Projects, Updates) stay inline.

- [ ] **Step 1: Delete the now-unused inline render functions, types, state, and handlers**

In `src/views/Settings.tsx`:

- Delete the inline `KNOWN_MODELS_BY_PROVIDER`, `PROVIDER_INFO_TOOLTIP`, `InfoIcon`, `OpenAICompatibleSection`, `DefaultsSection`, `ProviderConfig`, `OpenAICompatibleEndpoint`, `DefaultRef`, `SetupPhase`, `LoginPhase` definitions (lines ~10-18, 23-50, 130-144, 157-235, 237-433). These now live in `AIPanel.tsx`.
- Delete `ProvidersIcon` (lines 121-128) and `DesktopIcon` (lines 68-73).
- Delete imports `IconAnthropic`, `IconOpenAI`, `IconGemini`, `IconOllama` (lines 5-8). Keep `useAppearance`, `useGitHubAuth`, `useGitHubLogin` if any remain in scope; remove them if Settings.tsx no longer references them directly (they're now used by ConnectorsPanel only — `useAppearance` is still needed for the Appearance tab).
- Delete from `Settings` function body:
  - Provider state hooks (lines 477-484)
  - Provider-config load effect (lines 506-530)
  - All Claude Code / OpenCode state and handlers (lines 438-456, 603-605, 625-630, 738-782, 835-846, 1405-1451)
  - All MCP state and handlers (lines 615-622, 635-643, 645-675 [only the MCP and OpenCode parts], 784-813)
  - All custom-connector state (lines 594-613, 815-891 — except `useGitHubAuth`, `useGitHubLogin`, sync state etc. — those move into ConnectorsPanel)
  - GitHub state and handlers (`useGitHubAuth`, `useGitHubLogin`, all `githubXxx` declarations, `handleGitHubConnect`, `handleGitHubDisconnect` — lines 595-602, 820-833)
  - Skills sync state and handlers (lines 458-467, 486-489, 532-538, 540-568)
  - The `renderProviders`, `renderConnectors`, `renderClaudeOpenCode` functions themselves (lines 893-1047, 1049-1403, 1453-1570)
  - The `timers` ref if it's now unused in Settings.tsx (lines 632-633) — check whether anything outside the deleted blocks still pushes to it.

What remains in `Settings` function body: `useAppearance` destructure, language/TTS state, downloads state, projects state, updates state, and their handlers and JSX (Appearance, Language, Downloads, Projects, Updates tabs).

- [ ] **Step 2: Update the `CategoryId` enum and `CATEGORIES` array**

Find (line 12):

```tsx
type CategoryId = 'providers' | 'claude-opencode' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors' | 'updates'
```

Replace with:

```tsx
type CategoryId = 'ai' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors' | 'updates'
```

Find (line 146-155):

```tsx
const CATEGORIES: { id: CategoryId; label: string; icon: ReactNode }[] = [
  { id: 'providers', label: 'Providers', icon: <ProvidersIcon /> },
  { id: 'claude-opencode', label: 'Claude Code & OpenCode', icon: <DesktopIcon /> },
  { id: 'appearance', label: 'Appearance', icon: <PaletteIcon /> },
  { id: 'language', label: 'Language & Speech', icon: <GlobeIcon /> },
  { id: 'downloads', label: 'Downloads', icon: <DownloadIcon /> },
  { id: 'projects', label: 'Projects', icon: <ProjectsIcon /> },
  { id: 'connectors', label: 'Connectors', icon: <ConnectorsIcon /> },
  { id: 'updates', label: 'Updates', icon: <UpdatesIcon /> },
]
```

Replace with:

```tsx
const CATEGORIES: { id: CategoryId; label: string; icon: ReactNode }[] = [
  { id: 'ai',          label: 'AI',                 icon: <AIIcon /> },
  { id: 'appearance',  label: 'Appearance',         icon: <PaletteIcon /> },
  { id: 'language',    label: 'Language & Speech',  icon: <GlobeIcon /> },
  { id: 'downloads',   label: 'Downloads',          icon: <DownloadIcon /> },
  { id: 'projects',    label: 'Projects',           icon: <ProjectsIcon /> },
  { id: 'connectors',  label: 'Connectors',         icon: <ConnectorsIcon /> },
  { id: 'updates',     label: 'Updates',            icon: <UpdatesIcon /> },
]
```

- [ ] **Step 3: Update imports at the top of `Settings.tsx`**

Replace the existing icon imports (after deleting the simple-icons ones in step 1) with:

```tsx
import AIPanel from './settings/AIPanel'
import ConnectorsPanel from './settings/ConnectorsPanel'
import AIIcon from './settings/shared/AIIcon'
```

- [ ] **Step 4: Update the default active category and routing switch**

Find (line 437):

```tsx
const [activeCategory, setActiveCategory] = useState<CategoryId>('connectors')
```

Replace with:

```tsx
const [activeCategory, setActiveCategory] = useState<CategoryId>('ai')
```

Find the JSX routing block (lines 1854-1861):

```tsx
{activeCategory === 'providers' && renderProviders()}
{activeCategory === 'claude-opencode' && renderClaudeOpenCode()}
{activeCategory === 'appearance' && renderAppearance()}
{activeCategory === 'language' && renderLanguage()}
{activeCategory === 'downloads' && renderDownloads()}
{activeCategory === 'projects' && renderProjects()}
{activeCategory === 'connectors' && renderConnectors()}
{activeCategory === 'updates' && renderUpdates()}
```

Replace with:

```tsx
{activeCategory === 'ai'         && <AIPanel />}
{activeCategory === 'appearance' && renderAppearance()}
{activeCategory === 'language'   && renderLanguage()}
{activeCategory === 'downloads'  && renderDownloads()}
{activeCategory === 'projects'   && renderProjects()}
{activeCategory === 'connectors' && <ConnectorsPanel />}
{activeCategory === 'updates'    && renderUpdates()}
```

- [ ] **Step 5: Type-check and verify the file shrunk substantially**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `wc -l src/views/Settings.tsx` (or in PowerShell: `(Get-Content src/views/Settings.tsx | Measure-Object -Line).Lines`)
Expected: well under 1000 lines (was 1867). If much larger, there's dead code that didn't get removed in Step 1.

- [ ] **Step 6: Commit**

```bash
git add src/views/Settings.tsx
git commit -m "refactor(settings): unify Providers + Claude Code & OpenCode tabs into AI tab"
```

---

## Task 13: Update Settings.test.tsx for the new IA

**Files:**
- Modify: `src/views/Settings.test.tsx`

The existing tests reference the old `Claude Desktop` section title (already stale per recent renames). Replace with tests for the new IA and add smoke tests for AIPanel + ConnectorsPanel.

- [ ] **Step 1: Replace the file with the new test suite**

Replace the entire contents of `src/views/Settings.test.tsx` with:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Settings from './Settings'

function setupApi(opts: {
  mcpConfigured?: boolean
  configPath?: string | null
  anthropicKey?: string | null
} = {}) {
  Object.defineProperty(window, 'api', {
    value: {
      settings: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        getPreferredLanguage: vi.fn().mockResolvedValue('en'),
        setPreferredLanguage: vi.fn().mockResolvedValue(undefined),
      },
      skill: {
        detectClaudeCode: vi.fn().mockResolvedValue(false),
        checkAuthStatus:  vi.fn().mockResolvedValue(false),
        onSetupProgress:  vi.fn(),
        offSetupProgress: vi.fn(),
        onLoginProgress:  vi.fn(),
        offLoginProgress: vi.fn(),
        setup:        vi.fn().mockResolvedValue(undefined),
        loginClaude:  vi.fn().mockResolvedValue(undefined),
        logoutClaude: vi.fn().mockResolvedValue(undefined),
      },
      llm: {
        getProviderConfig: vi.fn().mockImplementation((p: string) =>
          Promise.resolve({ enabled: p === 'anthropic' && !!opts.anthropicKey, apiKey: p === 'anthropic' ? (opts.anthropicKey ?? undefined) : undefined })
        ),
        setProviderConfig: vi.fn().mockResolvedValue(undefined),
        listOpenAICompatibleEndpoints: vi.fn().mockResolvedValue([]),
        upsertOpenAICompatibleEndpoint: vi.fn().mockResolvedValue(undefined),
        removeOpenAICompatibleEndpoint: vi.fn().mockResolvedValue(undefined),
        getDefault: vi.fn().mockResolvedValue(undefined),
        setDefault: vi.fn().mockResolvedValue(undefined),
        testConnection: vi.fn().mockResolvedValue({ ok: true, sample: 'hi' }),
      },
      mcp: {
        getStatus: vi.fn().mockResolvedValue({
          configured: opts.mcpConfigured ?? false,
          configPath: opts.configPath ?? null,
        }),
        autoConfigure: vi.fn().mockResolvedValue({ success: true }),
        getConfigSnippet: vi.fn().mockResolvedValue('{"mcpServers":{"git-suite":{}}}'),
        testConnection: vi.fn().mockResolvedValue({ running: false, skillCount: 0 }),
      },
      opencode: {
        detect: vi.fn().mockResolvedValue(false),
        checkAuthStatus: vi.fn().mockResolvedValue(false),
        setup: vi.fn().mockResolvedValue({ ok: true }),
        loginOpenCode: vi.fn().mockResolvedValue({ ok: true }),
        logoutOpenCode: vi.fn().mockResolvedValue(undefined),
        onSetupProgress: vi.fn(),
        offSetupProgress: vi.fn(),
        onLoginProgress: vi.fn(),
        offLoginProgress: vi.fn(),
      },
      github: {
        disconnect: vi.fn().mockResolvedValue(undefined),
        openLoginPopup: vi.fn().mockResolvedValue(undefined),
      },
      skillSync: {
        getStatus: vi.fn().mockResolvedValue({ enabled: false, repoOwner: undefined, failedCount: 0, lastSynced: null }),
        onSyncFailed: vi.fn(),
        offSyncFailed: vi.fn(),
        setup: vi.fn(),
        disconnect: vi.fn(),
        retryFailed: vi.fn(),
      },
      connectors: {
        test: vi.fn().mockResolvedValue({ ok: true }),
      },
      download: {
        getDefaultFolder: vi.fn().mockResolvedValue('/default'),
        pickFolder: vi.fn().mockResolvedValue(null),
      },
      tts: {
        getVoices: vi.fn().mockResolvedValue([]),
        synthesize: vi.fn().mockResolvedValue({ audio: new ArrayBuffer(0), wordBoundaries: [] }),
        checkAvailable: vi.fn().mockResolvedValue(true),
      },
      updates: {
        lastChecked: vi.fn().mockResolvedValue({ timestamp: null }),
        checkNow: vi.fn().mockResolvedValue(undefined),
        restartService: vi.fn().mockResolvedValue(undefined),
      },
      openExternal: vi.fn().mockResolvedValue(undefined),
    },
    writable: true,
    configurable: true,
  })

  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  })
}

// Stub GitHubAuth + useGitHubLogin contexts — Settings imports them transitively via ConnectorsPanel.
vi.mock('../contexts/GitHubAuth', () => ({
  useGitHubAuth: () => ({ user: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useGitHubLogin', () => ({
  useGitHubLogin: () => ({
    status: 'idle',
    userCode: null,
    verificationUri: null,
    verificationUriComplete: null,
    error: null,
    start: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}))
vi.mock('../contexts/Appearance', () => ({
  useAppearance: () => ({ background: 'none', setBackground: vi.fn(), invertDarkImages: false, setInvertDarkImages: vi.fn() }),
}))

describe('Settings — sidebar IA', () => {
  beforeEach(() => { setupApi() })

  it('renders the AI sidebar entry', async () => {
    render(<Settings />)
    expect(screen.getByRole('button', { name: /^AI$/i })).toBeInTheDocument()
  })

  it('does NOT render the old "Providers" sidebar entry', () => {
    render(<Settings />)
    expect(screen.queryByRole('button', { name: /^Providers$/i })).not.toBeInTheDocument()
  })

  it('does NOT render the old "Claude Code & OpenCode" sidebar entry', () => {
    render(<Settings />)
    expect(screen.queryByRole('button', { name: /Claude Code & OpenCode/i })).not.toBeInTheDocument()
  })

  it('renders AI by default (no need to click)', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/API \/ HTTPS/i)).toBeInTheDocument()
    })
  })
})

describe('Settings — AI panel', () => {
  beforeEach(() => { setupApi() })

  it('renders all five AI section headers', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/API \/ HTTPS/i)).toBeInTheDocument()
      expect(screen.getByText(/^CLI$/)).toBeInTheDocument()
      expect(screen.getByText(/^MCP$/)).toBeInTheDocument()
      expect(screen.getByText(/Custom MCP/i)).toBeInTheDocument()
      expect(screen.getByText(/^Defaults$/i)).toBeInTheDocument()
    })
  })

  it('renders the Anthropic provider card in the API section', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/^Anthropic$/)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/sk-ant-/)).toBeInTheDocument()
    })
  })

  it("renders Anthropic's Claude Code card in the CLI section", async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/Anthropic's Claude Code/)).toBeInTheDocument()
    })
  })

  it('MCP section is collapsed by default when configured', async () => {
    setupApi({ mcpConfigured: true, configPath: '/path/to/config.json' })
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/^MCP$/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Manual configuration/i)).not.toBeInTheDocument()
  })

  it('MCP section is expanded by default when NOT configured', async () => {
    setupApi({ mcpConfigured: false })
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText(/Manual configuration/i)).toBeInTheDocument()
    })
  })

  it('clicking a section header toggles body visibility', async () => {
    render(<Settings />)
    await waitFor(() => screen.getByText(/^Defaults$/i))
    expect(screen.queryByText(/Which model is used for which feature/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/^Defaults$/i))
    expect(screen.getByText(/Which model is used for which feature/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/^Defaults$/i))
    expect(screen.queryByText(/Which model is used for which feature/i)).not.toBeInTheDocument()
  })

  it('clicking Test on Anthropic card calls llm.testConnection', async () => {
    setupApi({ anthropicKey: 'sk-ant-test' })
    render(<Settings />)
    await waitFor(() => screen.getByText(/^Anthropic$/))
    const testButtons = screen.getAllByRole('button', { name: /^Test$/i })
    fireEvent.click(testButtons[0])
    await waitFor(() => {
      expect(window.api.llm.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'anthropic' })
      )
    })
  })
})

describe('Settings — Connectors panel', () => {
  beforeEach(() => { setupApi() })

  it('shows the AI tab by default, so Connectors panel only appears after click', async () => {
    render(<Settings />)
    expect(screen.queryByText(/Connect external services Git Suite can read from/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Connectors$/ }))
    await waitFor(() => {
      expect(screen.getByText(/Connect external services Git Suite can read from/i)).toBeInTheDocument()
    })
  })

  it('renders GitHub and Skills Backup; does NOT render Claude subscription or Custom MCP rows', async () => {
    render(<Settings />)
    fireEvent.click(screen.getByRole('button', { name: /^Connectors$/ }))
    await waitFor(() => {
      expect(screen.getByText(/^GitHub$/)).toBeInTheDocument()
      expect(screen.getByText(/Skills Backup/i)).toBeInTheDocument()
    })
    // The Claude subscription row used to live here — it shouldn't anymore.
    expect(screen.queryByText(/skills use your subscription/i)).not.toBeInTheDocument()
    // The custom-connector add button also moved out.
    expect(screen.queryByText(/\+ Add custom connector/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test -- --run`
Expected: all tests pass. The new tests should be green; previously-failing tests (if any from the recent renames) are now removed/replaced.

- [ ] **Step 3: Commit**

```bash
git add src/views/Settings.test.tsx
git commit -m "test(settings): update Settings test suite for unified AI tab"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| Drop `'providers'` and `'claude-opencode'` from `CategoryId`, add `'ai'` | Task 12 |
| New `AIIcon` for sidebar | Task 4 + Task 12 |
| Default `activeCategory` flips to `'ai'` | Task 12 |
| Five collapsible sections in AIPanel | Tasks 5-10 |
| API section: Anthropic, OpenAI, Gemini, Local | Task 6 |
| CLI section: Anthropic's Claude Code, OpenCode | Task 7 |
| MCP section content (status, snippet, copy, test) | Task 8 |
| Custom MCP section content | Task 9 |
| Defaults section (lifts `DefaultsSection`) | Task 10 |
| Standardized `ProviderCard` format | Task 3 (component) + Tasks 6-7 (consumers) |
| Card descriptions per spec table | Task 6 + Task 7 |
| Anthropic's Claude Code naming | Task 7 |
| `~icons/simple-icons/claude` for Claude Code card | Task 7 |
| Chip colors + section CSS | Task 1 |
| `SectionBlock` contract | Task 2 |
| `ProviderCard` contract | Task 3 |
| MCP `defaultExpanded={!mcpConfigured}` | Task 8 |
| Slim ConnectorsPanel (GitHub + Skills Backup only) | Task 11 |
| Connectors hint text update | Task 11 |
| Test updates for new IA | Task 13 |
| No persistence of collapsed state | Task 2 (in-memory `useState`) |

### Placeholder scan

No "TBD", "TODO", "implement later", "add appropriate error handling", or "similar to Task N" patterns in any task. Every step contains the actual code, command, or file change required. The deletion list in Task 12 Step 1 uses approximate line numbers ("lines ~X-Y") — exact ranges are spelled out for each block being moved.

### Type consistency

- `SectionBlockProps` (Task 2) and its `defaultExpanded?: boolean`, `badge?: 'BETA'` match all call sites in Tasks 5-10.
- `ProviderCardProps` (Task 3) — `chip: 'API' | 'CLI' | 'MCP'`, `status?: { tone: 'green' | 'amber' | 'red' | 'gray'; text: string }` — match the consumers in Tasks 6-7.
- `DefaultRef`, `ProviderConfig`, `OpenAICompatibleEndpoint` (defined at Task 6 module scope) are referenced consistently in Tasks 6 and 10.
- `SetupPhase`, `LoginPhase` (defined at Task 7 module scope) are used consistently in Task 7's Claude Code and OpenCode handlers.
- All `window.api.*` paths used in tasks match the existing IPC surface (verified against the original `Settings.tsx`).

No type drift detected.
