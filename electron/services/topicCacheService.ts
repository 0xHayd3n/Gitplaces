// electron/services/topicCacheService.ts
//
// Warms the `topic_cache` SQLite table with the GitHub topics catalog so that
// Discover's typeahead and the recommendation engine can resolve topics
// offline. Extracted from electron/main.ts during Phase 3 so the hosts:* IPC
// handlers (electron/ipc/hostHandlers.ts) can call it after a successful
// pollDeviceToken without creating a circular import on main.ts.
//
// The cache is considered stale after 7 days; we refetch then. Failures are
// non-critical — the worst case is Discover falls back to network on next use.
import { app } from 'electron'
import { getDb } from '../db'
import { getProvider } from '../providers/registry'
import { HOST_ID_GITHUB } from '../providers/types'

const TOPIC_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function initTopicCache(token: string): Promise<void> {
  const db = getDb(app.getPath('userData'))
  const count = db.prepare('SELECT COUNT(*) as n FROM topic_cache').get() as { n: number }
  const lastFetch = db.prepare(
    'SELECT fetched_at FROM topic_cache ORDER BY fetched_at DESC LIMIT 1'
  ).get() as { fetched_at: string } | undefined

  const isStale = !lastFetch ||
    (Date.now() - new Date(lastFetch.fetched_at).getTime()) > TOPIC_CACHE_TTL_MS

  if (count.n === 0 || isStale) {
    try {
      const gh = getProvider(HOST_ID_GITHUB)
      if (!gh) return
      const topics = await gh.fetchGitHubTopics(token)
      const now = new Date().toISOString()
      const insert = db.prepare('INSERT OR REPLACE INTO topic_cache (topic, fetched_at) VALUES (?, ?)')
      const insertMany = db.transaction((ts: string[]) => {
        for (const topic of ts) insert.run(topic, now)
      })
      insertMany(topics)
    } catch {
      // Non-critical — silently ignore
    }
  }
}
