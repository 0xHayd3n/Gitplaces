import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RepoRouteCompatRedirect } from './RepoRouteCompatRedirect'

// The runtime shape of window.api.repo.getSaved() is { owner, name }[] (no
// hostId yet — see electron/ipc/repoHandlers.ts and the env.d.ts declaration).
// The compat redirect tolerates this: missing hostId → fallback to
// HOST_ID_GITHUB. Once Phase 4+ widens the shape to include hostId, the redirect
// will start honoring it without code changes.
beforeEach(() => {
  Object.defineProperty(window, 'api', {
    value: {
      ...(window as { api?: unknown }).api ?? {},
      repo: {
        getSaved: vi.fn().mockResolvedValue([
          { owner: 'foo', name: 'bar' },
        ]),
      },
    },
    writable: true,
    configurable: true,
  })
})

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/repo/:owner/:name" element={<RepoRouteCompatRedirect />} />
        <Route path="/repo/:hostId/:owner/:name" element={<div data-testid="new-route" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RepoRouteCompatRedirect', () => {
  it('redirects to /repo/<HOST_ID_GITHUB>/owner/name when the repo is in the saved library', async () => {
    renderAt('/repo/foo/bar')
    await waitFor(() => expect(screen.getByTestId('new-route')).toBeInTheDocument())
  })

  it('falls back to HOST_ID_GITHUB when the repo is not in the saved library', async () => {
    ;(window.api.repo.getSaved as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    renderAt('/repo/foo/bar')
    await waitFor(() => expect(screen.getByTestId('new-route')).toBeInTheDocument())
  })
})
