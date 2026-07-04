// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRepo, putFileContents } from '../providers/github'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

describe('createRepo', () => {
  it('POSTs to /user/repos and returns html_url', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ html_url: 'https://github.com/user/gitplaces-skills' })
    })
    const result = await createRepo('tok', 'gitplaces-skills')
    expect(result.html_url).toBe('https://github.com/user/gitplaces-skills')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/user/repos',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 422 })
    await expect(createRepo('tok', 'gitplaces-skills')).rejects.toThrow('422')
  })
})

describe('putFileContents', () => {
  it('PUTs base64-encoded content and returns sha', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: { sha: 'abc123' } })
    })
    const result = await putFileContents('tok', 'user', 'gitplaces-skills', 'ms/vscode.skill.md', 'hello', 'update')
    expect(result.content.sha).toBe('abc123')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.content).toBe(Buffer.from('hello').toString('base64'))
    expect(body.sha).toBeUndefined()
    // Path must NOT be percent-encoded — slash must remain a slash
    expect(mockFetch.mock.calls[0][0]).toContain('ms/vscode.skill.md')
    expect(mockFetch.mock.calls[0][0]).not.toContain('%2F')
  })

  it('includes sha in body when provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ content: { sha: 'def456' } }) })
    await putFileContents('tok', 'user', 'repo', 'path', 'content', 'msg', 'oldshavalue')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.sha).toBe('oldshavalue')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 409 })
    await expect(putFileContents('tok', 'u', 'r', 'p', 'c', 'm')).rejects.toThrow('409')
  })
})
