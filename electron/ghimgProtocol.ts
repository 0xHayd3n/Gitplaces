import { protocol, net } from 'electron'
import { getToken } from './providers/tokenStore'
import { HOST_ID_GITHUB } from './providers/types'
import { LRUCache } from './lruCache'

// GitHub asset URLs (github.com/user/repo/assets/ID/UUID) redirect to
// private-user-images.githubusercontent.com which requires GitHub auth.
// This protocol proxies those requests through the stored token so <img>
// tags in the renderer can load them without a browser session.

const GHIMG_CACHE_TTL = 60 * 60 * 1000 // 1 hour
const ghimgCache = new LRUCache<string, { buffer: ArrayBuffer; contentType: string; ts: number }>(100)

export function registerGhImgProtocol(): void {
  protocol.handle('ghimg', async (request) => {
    const originalUrl = 'https://' + request.url.slice('ghimg://'.length)

    const cached = ghimgCache.get(originalUrl)
    if (cached && Date.now() - cached.ts < GHIMG_CACHE_TTL) {
      return new Response(cached.buffer, { headers: { 'Content-Type': cached.contentType } })
    }

    const token = getToken(HOST_ID_GITHUB)
    const headers: Record<string, string> = {
      'User-Agent': 'Gitplaces/1.0',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    try {
      const response = await net.fetch(originalUrl, {
        signal: AbortSignal.timeout(20000),
        headers,
      })

      if (!response.ok) return new Response(null, { status: response.status })

      const buffer = await response.arrayBuffer()
      const contentType = response.headers.get('Content-Type') ?? 'image/gif'
      ghimgCache.set(originalUrl, { buffer, contentType, ts: Date.now() })
      return new Response(buffer, { headers: { 'Content-Type': contentType } })
    } catch {
      return new Response(null, { status: 500 })
    }
  })
}
