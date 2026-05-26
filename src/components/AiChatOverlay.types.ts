export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
  contentHtml?: string
  repoCards?: { owner: string; name: string; description: string; stars: number; language: string }[]
  actions?: { action: string; owner: string; name: string; result?: string }[]
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]
  toolResults?: { id: string; result: unknown; isError: boolean }[]
  timestamp: number
}
