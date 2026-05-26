import { ipcMain, app, BrowserWindow } from 'electron'
import { getDb } from '../db'
import { runChat, parseAssistantMessage, AiChatMessage, renderContentHtml } from '../services/aiChatService'
import type { AgentEvent, ModelRef } from '../llm/types'

export function registerAiChatHandlers(): void {
  ipcMain.handle('ai:getChats', () => {
    const db = getDb(app.getPath('userData'))
    return db.prepare(
      'SELECT id, title, updated_at FROM ai_chats ORDER BY updated_at DESC'
    ).all()
  })

  ipcMain.handle('ai:getChat', (_event, id: number) => {
    const db = getDb(app.getPath('userData'))
    const row = db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(id) as {
      id: number; title: string; messages: string; created_at: string; updated_at: string
    } | undefined
    if (!row) return null
    return { ...row, messages: JSON.parse(row.messages) as AiChatMessage[] }
  })

  ipcMain.handle('ai:saveChat', (_event, chat: { id?: number; title: string; messages: AiChatMessage[] }) => {
    const db = getDb(app.getPath('userData'))
    const messagesJson = JSON.stringify(chat.messages)
    if (chat.id) {
      if (chat.title) {
        db.prepare(
          'UPDATE ai_chats SET title = ?, messages = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).run(chat.title, messagesJson, chat.id)
      } else {
        db.prepare(
          'UPDATE ai_chats SET messages = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).run(messagesJson, chat.id)
      }
      return chat.id
    } else {
      const result = db.prepare(
        'INSERT INTO ai_chats (title, messages) VALUES (?, ?)'
      ).run(chat.title, messagesJson)
      return result.lastInsertRowid
    }
  })

  ipcMain.handle('ai:deleteChat', (_event, id: number) => {
    const db = getDb(app.getPath('userData'))
    db.prepare('DELETE FROM ai_chats WHERE id = ?').run(id)
  })

  ipcMain.handle('ai:sendMessage', async (event, payload: {
    messages: AiChatMessage[]
    starredRepos: string[]
    installedSkills: string[]
    pageContext?: string
    agentId?: number | null
    modelRef?: ModelRef
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      throw new Error('Browser window not found')
    }
    return new Promise<{ text: string; html: string }>((resolve, reject) => {
      runChat(
        {
          messages: payload.messages,
          starredRepos: payload.starredRepos,
          installedSkills: payload.installedSkills,
          pageContext: payload.pageContext,
          agentId: payload.agentId ?? null,
          modelRef: payload.modelRef,
        },
        {
          onToken: (token) => {
            if (!win.isDestroyed()) {
              win.webContents.send('ai:stream-token', token)
            }
          },
          onEvent: (ev: AgentEvent) => {
            if (!win.isDestroyed()) {
              win.webContents.send('ai:stream-event', ev)
            }
          },
          onDone: (fullText) => {
            resolve({ text: fullText, html: renderContentHtml(fullText) })
          },
          onError: (error) => {
            reject(new Error(error))
          },
        }
      ).catch((err) => {
        console.error('[ai-chat] runChat unhandled error:', err)
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    })
  })
}
