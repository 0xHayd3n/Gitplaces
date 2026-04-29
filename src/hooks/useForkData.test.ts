import { renderHook, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeAll, afterEach } from 'vitest'

const mockGetRepo = vi.fn()

beforeAll(() => {
  Object.defineProperty(window, 'api', {
    value: { github: { getRepo: mockGetRepo } },
    configurable: true,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

// Import after window.api is defined
const { useForkData } = await import('./useForkData')

describe('useForkData', () => {
  it('starts loading and resolves both repos', async () => {
    mockGetRepo.mockImplementation(async (owner: string, name: string) => ({
      owner, name,
      description: `desc for ${name}`,
      language: 'TypeScript',
      stars: 100,
      forks: 10,
    }))

    const { result } = renderHook(() =>
      useForkData('acme/original-a1', 'user/fork-a1')
    )

    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.original).toMatchObject({ owner: 'acme', name: 'original-a1', stars: 100 })
    expect(result.current.fork).toMatchObject({ owner: 'user', name: 'fork-a1', stars: 100 })
    expect(mockGetRepo).toHaveBeenCalledTimes(2)
  })

  it('stores null and does not retry when getRepo returns null', async () => {
    mockGetRepo.mockResolvedValue(null)

    const { result } = renderHook(() =>
      useForkData('acme/original-b2', 'user/fork-b2')
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.original).toBeNull()
    expect(result.current.fork).toBeNull()
  })

  it('stores null and does not retry when getRepo rejects', async () => {
    mockGetRepo.mockRejectedValue(new Error('IPC error'))

    const { result } = renderHook(() =>
      useForkData('acme/original-c3', 'user/fork-c3')
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.original).toBeNull()
    expect(result.current.fork).toBeNull()
  })

  it('skips API call for cached keys and resolves immediately', async () => {
    // First render populates cache for d4 keys
    mockGetRepo.mockResolvedValue({ owner: 'acme', name: 'original-d4', description: null, language: null, stars: 0, forks: 0 })
    const { unmount } = renderHook(() => useForkData('acme/original-d4', 'user/fork-d4'))
    await waitFor(() => expect(mockGetRepo).toHaveBeenCalledTimes(2))
    unmount()
    mockGetRepo.mockClear()

    // Second render — same keys, should hit cache
    const { result } = renderHook(() => useForkData('acme/original-d4', 'user/fork-d4'))
    expect(result.current.loading).toBe(false)
    expect(mockGetRepo).not.toHaveBeenCalled()
  })

  it('fetches only the uncached key on a partial cache hit', async () => {
    // Pre-populate cache for original-e5 from a prior render
    mockGetRepo.mockResolvedValueOnce({ owner: 'acme', name: 'original-e5', description: null, language: null, stars: 5, forks: 0 })
    mockGetRepo.mockResolvedValueOnce(null) // fork-e5 → null
    const { unmount } = renderHook(() => useForkData('acme/original-e5', 'user/fork-e5'))
    await waitFor(() => expect(mockGetRepo).toHaveBeenCalledTimes(2))
    unmount()
    mockGetRepo.mockClear()

    // New fork key fork-f6, same original — only fork should be fetched
    mockGetRepo.mockResolvedValueOnce({ owner: 'user', name: 'fork-f6', description: null, language: null, stars: 0, forks: 0 })
    const { result } = renderHook(() => useForkData('acme/original-e5', 'user/fork-f6'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockGetRepo).toHaveBeenCalledTimes(1)
    expect(mockGetRepo).toHaveBeenCalledWith('user', 'fork-f6')
    expect(result.current.original).toMatchObject({ stars: 5 })
    expect(result.current.fork).toMatchObject({ name: 'fork-f6' })
  })
})
