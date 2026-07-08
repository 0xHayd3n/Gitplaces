import { spawn } from 'child_process'
import type { ModelRef } from '../llm/types'
import { findOpenCodeBinary } from '../skill-gen/opencode'

export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
  contentHtml?: string
  repoCards?: { owner: string; name: string; description: string; stars: number; language: string }[]
  actions?: { action: string; owner: string; name: string; result?: string }[]
  timestamp: number
}

/** Convert markdown content to HTML, stripping repo/action blocks */
export function renderContentHtml(content: string): string {
  let html = content
    // Strip structured blocks
    .replace(/```repo\n[\s\S]*?```/g, '')
    .replace(/```action\n[\s\S]*?```/g, '')
    .trim()
  // Escape HTML
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // Convert list patterns to items
  html = html.replace(/(?:^|\n)\s*[-•]\s+/g, '\n- ')
  // Build block structure
  const lines = html.split('\n')
  const out: string[] = []
  let inList = false
  for (const line of lines) {
    if (line.match(/^- /)) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${line.slice(2)}</li>`)
    } else {
      if (inList) { out.push('</ul>'); inList = false }
      if (line.trim()) out.push(`<p>${line}</p>`)
    }
  }
  if (inList) out.push('</ul>')
  return out.join('')
}

interface StreamCallbacks {
  onToken: (token: string) => void
  onDone: (fullText: string) => void
  onError: (error: string) => void
}

function buildSystemPrompt(starredRepos: string[], installedSkills: string[], pageContext?: string): string {
  const pageSection = pageContext
    ? `\n## Current Page\nThe user is currently on: **${pageContext}**\nWhen the user asks what page they are on, where they are, or anything about the current view, tell them exactly which page they are on and what it does. Your answers should always be relevant to this page context.`
    : ''

  return `You are an assistant embedded inside **Gitplaces**, a desktop GitHub repository explorer app.
${pageSection}

## Gitplaces Pages
- **Discover** — main page for searching, browsing, and discovering new GitHub repositories
- **My Library** — user's saved/installed repositories and generated skills
- **Collections** — user's curated groupings of repos organized by theme or project
- **Starred** — user's GitHub starred repos synced from their account
- **Repository Detail** — detail view for a specific repo showing README, files, stats, and actions
- **Settings** — app configuration (GitHub token, Claude API key, preferences)

## What You Can Do
Help users find, evaluate, and manage repositories.

You can perform these actions by including JSON blocks in your response:

1. Suggest repos — include a block like:
\`\`\`repo
{"owner":"example","name":"repo","description":"A great tool","stars":1234,"language":"TypeScript"}
\`\`\`

2. Execute actions — include a block like:
\`\`\`action
{"action":"star","owner":"example","name":"repo"}
\`\`\`
Valid actions: "star", "unstar", "install" (generates skill), "navigate" (opens repo detail)

## Format Rules (ALWAYS follow)
- Use proper markdown: **bold**, *italic*, \`code\`, lists with newlines
- For lists, put each item on its own line with a blank line before the list
- Keep responses concise — 2-3 short sentences max unless the user asks for detail
- Only suggest repos you are confident exist on GitHub
- When suggesting repos, always include the \`\`\`repo block so they render as clickable cards

${starredRepos.length > 0 ? `\nUser's starred repos (don't re-suggest unless asked): ${starredRepos.join(', ')}` : ''}
${installedSkills.length > 0 ? `\nUser's installed skills (don't suggest installing again): ${installedSkills.join(', ')}` : ''}`
}

export async function sendMessageStream(
  messages: AiChatMessage[],
  starredRepos: string[],
  installedSkills: string[],
  pageContext: string | undefined,
  modelRef: ModelRef,
  callbacks: StreamCallbacks
): Promise<void> {
  const { detectClaudeCode, checkAuthStatus, findNode, findLocalCli, buildEnv } =
    await import('../skill-gen/legacy')

  // Branch on provider to pick the right CLI.
  if (modelRef.provider === 'opencode') {
    const bin = findOpenCodeBinary()
    if (!bin) {
      callbacks.onError('OpenCode CLI not found. Install via Settings → Claude Code & OpenCode.')
      return
    }
    return spawnOpenCodeChat(bin, messages, starredRepos, installedSkills, pageContext, modelRef, callbacks)
  }

  const detected = await detectClaudeCode()
  if (!detected) {
    callbacks.onError('Claude Code CLI not found. Please install it first via Settings.')
    return
  }

  const authed = await checkAuthStatus()
  if (!authed) {
    callbacks.onError('Claude Code is not logged in. Run `claude login` in a terminal, then try again.')
    return
  }

  const nodePath = await findNode()
  if (!nodePath) {
    callbacks.onError('Node.js not found. Please ensure Node.js is installed.')
    return
  }

  const cliPath = findLocalCli()
  if (!cliPath) {
    callbacks.onError('Claude Code not found in node_modules. Run npm install.')
    return
  }

  const systemPrompt = buildSystemPrompt(starredRepos, installedSkills, pageContext)
  const apiMessages = messages.map(m => ({ role: m.role, content: m.content }))

  // Build the prompt: system prompt + conversation history
  const prompt = `${systemPrompt}\n\n${apiMessages.map(m => `${m.role}: ${m.content}`).join('\n')}`

  console.log('[ai-chat] Spawning CLI, node:', nodePath, 'cli:', cliPath)

  const proc = spawn(
    nodePath,
    [cliPath, '--print', '--output-format', 'json', '--max-turns', '1', '--model', 'claude-sonnet-4-6'],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildEnv(true),
    }
  )

  const chunks: Buffer[] = []
  let errOutput = ''

  proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))

  proc.stderr.on('data', (chunk: Buffer) => {
    errOutput += chunk.toString('utf8')
  })

  proc.on('error', (err) => {
    console.error('[ai-chat] Failed to spawn CLI:', err.message)
    callbacks.onError(`Failed to start Claude CLI: ${err.message}`)
  })

  proc.on('close', (code) => {
    const stdout = Buffer.concat(chunks).toString('utf8')

    // Parse JSON result (same format as skill generation)
    try {
      const parsed = JSON.parse(stdout) as { result?: string; is_error?: boolean }
      if (parsed.is_error) {
        const msg = parsed.result ?? 'Unknown CLI error'
        console.error('[ai-chat] CLI error:', msg)
        callbacks.onError(msg)
        return
      }
      const result = parsed.result ?? ''
      console.log('[ai-chat] CLI complete, response length:', result.length)
      callbacks.onToken(result)
      callbacks.onDone(result)
      return
    } catch { /* not JSON, try raw */ }

    if (code !== 0) {
      const detail = errOutput || stdout || '(no output)'
      console.error('[ai-chat] CLI exited with code', code, ':', detail.slice(0, 500))
      callbacks.onError(`Claude CLI error (code ${code}): ${detail.slice(0, 300)}`)
      return
    }

    // Raw text fallback
    const result = stdout.trim()
    callbacks.onToken(result)
    callbacks.onDone(result)
  })

  proc.stdin.write(prompt, 'utf8')
  proc.stdin.end()
}

async function spawnOpenCodeChat(
  bin: string,
  messages: AiChatMessage[],
  starredRepos: string[],
  installedSkills: string[],
  pageContext: string | undefined,
  modelRef: ModelRef,
  callbacks: StreamCallbacks
): Promise<void> {
  const { buildEnv } = await import('../skill-gen/legacy')
  const systemPrompt = buildSystemPrompt(starredRepos, installedSkills, pageContext)
  const prompt = `${systemPrompt}\n\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`

  console.log('[ai-chat] Spawning OpenCode CLI, bin:', bin, 'model:', modelRef.model)

  // OpenCode CLI args: `opencode run --print --model <model>` reading prompt from stdin.
  const proc = spawn(bin, ['run', '--print', '--model', modelRef.model], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildEnv(true),
    shell: process.platform === 'win32',
  })

  const chunks: Buffer[] = []
  let errOutput = ''

  proc.stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
    // OpenCode may stream incrementally — forward each chunk as a token.
    callbacks.onToken(chunk.toString('utf8'))
  })

  proc.stderr.on('data', (chunk: Buffer) => {
    errOutput += chunk.toString('utf8')
  })

  proc.on('error', (err) => {
    console.error('[ai-chat] Failed to spawn OpenCode CLI:', err.message)
    callbacks.onError(`Failed to start OpenCode CLI: ${err.message}`)
  })

  proc.on('close', (code) => {
    const stdout = Buffer.concat(chunks).toString('utf8')
    if (code !== 0) {
      const detail = errOutput || stdout || '(no output)'
      console.error('[ai-chat] OpenCode exited with code', code, ':', detail.slice(0, 500))
      callbacks.onError(`OpenCode CLI error (code ${code}): ${detail.slice(0, 300)}`)
      return
    }
    callbacks.onDone(stdout.trim())
  })

  proc.stdin.write(prompt, 'utf8')
  proc.stdin.end()
}

export function parseAssistantMessage(content: string): AiChatMessage {
  const repoCards: AiChatMessage['repoCards'] = []
  const actions: AiChatMessage['actions'] = []

  const repoRegex = /```repo\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = repoRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (typeof parsed.owner === 'string' && typeof parsed.name === 'string' && typeof parsed.description === 'string') {
        repoCards.push({ owner: parsed.owner, name: parsed.name, description: parsed.description, stars: Number(parsed.stars) || 0, language: String(parsed.language || '') })
      }
    } catch (err) {
      console.warn('[ai-chat] skipping malformed ```repo``` block:', err)
    }
  }

  const actionRegex = /```action\n([\s\S]*?)```/g
  while ((match = actionRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (typeof parsed.action === 'string' && typeof parsed.owner === 'string' && typeof parsed.name === 'string') {
        actions.push({ action: parsed.action, owner: parsed.owner, name: parsed.name, result: parsed.result != null ? String(parsed.result) : undefined })
      }
    } catch (err) {
      console.warn('[ai-chat] skipping malformed ```action``` block:', err)
    }
  }

  return {
    role: 'assistant',
    content,
    repoCards: repoCards.length > 0 ? repoCards : undefined,
    actions: actions.length > 0 ? actions : undefined,
    timestamp: Date.now(),
  }
}

export { buildSystemPrompt }
export { runChat } from './dispatchChat'
export type { RunChatRequest, RunChatCallbacks } from './dispatchChat'
