// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: mockHandle },
}))

const mockLogClick = vi.fn()
vi.mock('../services/engagementTracker', () => ({
  logClick: mockLogClick,
}))

vi.mock('../db', () => ({
  getDb: vi.fn().mockReturnValue({}),
}))

describe('registerEngagementHandlers', () => {
  beforeEach(() => {
    mockHandle.mockReset()
    mockLogClick.mockReset()
  })

  it('registers engagement:logClick and forwards arguments to logClick', async () => {
    const { registerEngagementHandlers } = await import('./engagementHandlers')
    registerEngagementHandlers()
    expect(mockHandle).toHaveBeenCalledWith('engagement:logClick', expect.any(Function))
    const handler = mockHandle.mock.calls[0][1]
    handler({}, 'repo-42', 'recommended')
    expect(mockLogClick).toHaveBeenCalledWith({}, 'repo-42', 'recommended')
  })
})
