import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ReadmeRenderer from './ReadmeRenderer'
import type { LinkPreviewResult } from '../utils/linkPreviewFetcher'

// window.api.openExternal is called inside the <a> onClick handler.
// We stub it so any test that triggers a click (or future tests) won't throw.
beforeEach(() => {
  Object.defineProperty(window, 'api', {
    writable: true,
    value: {
      openExternal: vi.fn().mockResolvedValue(undefined),
      linkPreview: {
        fetch: vi.fn().mockResolvedValue({
          title: 'Test Page', description: 'A description', imageUrl: '',
          faviconUrl: '', domain: 'example.com',
        }),
      },
      repo: {
        get: vi.fn().mockResolvedValue(null),
      },
    },
  })
  // JSDOM doesn't implement scrollIntoView — stub it so footnote ref clicks don't throw
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

// JSDOM doesn't fire onLoad, so post-load refinement is not tested here
// (covered separately in Task 5).

const defaultProps = {
  repoOwner: 'owner',
  repoName: 'repo',
  branch: 'main',
}

function renderMd(content: string) {
  return render(
    <MemoryRouter>
      <ReadmeRenderer {...defaultProps} content={content} />
    </MemoryRouter>
  )
}

// ── Image classification ──────────────────────────────────────────────

describe('image classification', () => {
  it('renders a linked image with rm-img-content class', async () => {
    const { container } = renderMd('[![Logo](https://example.com/logo.png)](https://example.com)')
    const img = container.querySelector('img')
    expect(img?.className).toContain('rm-img-content')
  })

  it('does NOT add rm-img-clickable to a linked image', async () => {
    const { container } = renderMd('[![Logo](https://example.com/logo.png)](https://example.com)')
    const img = container.querySelector('img')
    expect(img?.className).not.toContain('rm-img-clickable')
  })

  it('renders a standalone image under a sponsor heading with rm-img-logo', async () => {
    const md = '## Sponsors\n\n![logo](https://example.com/logo.png)'
    const { container } = renderMd(md)
    const img = container.querySelector('img')
    expect(img?.className).toContain('rm-img-logo')
  })

  it('renders a standalone image under an unrelated heading with rm-img-content', async () => {
    const md = '## Installation\n\n![screenshot](https://example.com/screen.png)'
    const { container } = renderMd(md)
    const img = container.querySelector('img')
    expect(img?.className).toContain('rm-img-content')
  })

  it('renders an unlinked image with no context as rm-img-content', async () => {
    const { container } = renderMd('![screenshot](https://example.com/screen.png)')
    const img = container.querySelector('img')
    expect(img?.className).toContain('rm-img-content')
  })

  it('applies rm-logo-row to a paragraph containing only linked images', async () => {
    const md = [
      '[![a](https://example.com/a.png)](https://a.com)',
      '[![b](https://example.com/b.png)](https://b.com)',
    ].join(' ')
    const { container } = renderMd(md)
    const p = container.querySelector('p')
    expect(p?.className).toContain('rm-logo-row')
  })

  it('does NOT apply rm-logo-row to a paragraph with mixed content', async () => {
    const md = 'Some text and [![img](https://example.com/a.png)](https://a.com)'
    const { container } = renderMd(md)
    const p = container.querySelector('p')
    expect(p?.className).not.toContain('rm-logo-row')
  })
})

// ── Footnote references ───────────────────────────────────────────────

describe('footnote references', () => {
  it('keeps external link as hyperlink and appends references section', () => {
    const { container } = renderMd('[link text](https://example.com/page)')
    // No inline superscript — the link itself stays as a clickable <a>
    const sup = container.querySelector('sup')
    expect(sup).toBeNull()
    // The inline <a> should still exist with the correct href
    const inlineLink = container.querySelector('a[href="https://example.com/page"]') as HTMLAnchorElement | null
    expect(inlineLink).not.toBeNull()
    expect(inlineLink?.textContent).toBe('link text')
    // The inline link should have an fn-ref id stamped on it
    expect(inlineLink?.id).toMatch(/^fn-ref-\d+$/)
    // The references section should be appended
    const refs = container.querySelector('.rm-references')
    expect(refs).not.toBeNull()
    const refUrl = container.querySelector('.rm-reference-url') as HTMLAnchorElement | null
    expect(refUrl).not.toBeNull()
    expect(refUrl?.getAttribute('href')).toBe('https://example.com/page')
  })
})

// ── Footnote highlight history ────────────────────────────────────

describe('footnote click highlight history', () => {
  // Builds markdown with N distinct external links so we get N footnote entries
  function buildMd(n: number) {
    return Array.from({ length: n }, (_, i) =>
      `[link${i + 1}](https://example${i + 1}.com)`
    ).join(' ')
  }

  function clickRef(container: HTMLElement, n: number) {
    // The inline external link has id="fn-ref-N" stamped by rehypeFootnoteLinks.
    // Clicking it calls openExternal AND updates fnHistory (new behaviour).
    const anchor = container.querySelector(`a[id="fn-ref-${n}"]`) as HTMLAnchorElement | null
    expect(anchor).not.toBeNull()
    act(() => { anchor!.click() })
  }

  it('adds rm-fn-active-0 to the ref item after clicking its footnote link', async () => {
    const { container } = renderMd('[link](https://example.com/page)')
    clickRef(container, 1)
    await waitFor(() => {
      const li = container.querySelector('#fn-1') as HTMLElement | null
      expect(li?.className).toContain('rm-fn-active-0')
    })
  })

  it('demotes previous active item to rm-fn-active-1 when a new footnote is clicked', async () => {
    const { container } = renderMd(buildMd(2))
    clickRef(container, 1)
    await waitFor(() => {
      expect(container.querySelector('#fn-1')?.className).toContain('rm-fn-active-0')
    })
    clickRef(container, 2)
    await waitFor(() => {
      expect(container.querySelector('#fn-2')?.className).toContain('rm-fn-active-0')
      expect(container.querySelector('#fn-1')?.className).toContain('rm-fn-active-1')
    })
  })

  it('fills all 5 levels correctly after 5 clicks', async () => {
    const { container } = renderMd(buildMd(5))
    for (let n = 1; n <= 5; n++) clickRef(container, n)
    await waitFor(() => {
      for (let pos = 0; pos < 5; pos++) {
        const n = 5 - pos          // n=5 is level-0, n=1 is level-4
        const li = container.querySelector(`#fn-${n}`) as HTMLElement | null
        expect(li?.className).toContain(`rm-fn-active-${pos}`)
      }
    })
  })

  it('removes the oldest entry (returns to default) after a 6th click', async () => {
    const { container } = renderMd(buildMd(6))
    // Click 1..5 to fill history, then click 6 to push fn-1 out
    for (let n = 1; n <= 6; n++) clickRef(container, n)
    await waitFor(() => {
      const li = container.querySelector('#fn-1') as HTMLElement | null
      // fn-1 should have no rm-fn-active-* class
      expect(li?.className).not.toMatch(/rm-fn-active-/)
      // fn-6 should now be the most recently visited
      expect(container.querySelector('#fn-6')?.className).toContain('rm-fn-active-0')
    })
  })

  it('re-clicking an already-visited footnote moves it back to active-0', async () => {
    const { container } = renderMd(buildMd(2))
    clickRef(container, 1)
    clickRef(container, 2)
    // fn-1 is now level-1; click it again
    clickRef(container, 1)
    await waitFor(() => {
      expect(container.querySelector('#fn-1')?.className).toContain('rm-fn-active-0')
      expect(container.querySelector('#fn-2')?.className).toContain('rm-fn-active-1')
    })
  })
})

// ── Link hover status bar ─────────────────────────────────────────────

describe('link hover status bar', () => {
  it('shows no status bar initially', () => {
    const { container } = renderMd('[link text](https://example.com)')
    const bar = container.querySelector('.rm-status-bar') as HTMLElement | null
    expect(bar?.style.display).toBe('none')
  })

  it('shows status bar with URL on hover over reference list URL', async () => {
    // External links are now replaced with [n] footnote refs — the real URL lives
    // in the references section at the bottom as a .rm-reference-url anchor.
    const { container } = renderMd('[link text](https://example.com/page)')
    const refLink = container.querySelector('.rm-reference-url') as HTMLAnchorElement | null
    expect(refLink).not.toBeNull()
    act(() => {
      refLink!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    const bar = container.querySelector('.rm-status-bar')
    expect(bar).not.toBeNull()
    expect(bar?.textContent).toBe('https://example.com/page')
  })

  it('hides status bar on link mouseleave', async () => {
    const { container } = renderMd('[link text](https://example.com/page)')
    const refLink = container.querySelector('.rm-reference-url') as HTMLAnchorElement | null
    act(() => {
      refLink!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    act(() => {
      refLink!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })
    const bar = container.querySelector('.rm-status-bar') as HTMLElement | null
    expect(bar?.style.display).toBe('none')
  })

  it('does not show status bar for anchor links (#hash)', () => {
    const { container } = renderMd('[section](#install)')
    const link = container.querySelector('a')!
    act(() => {
      link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    const bar = container.querySelector('.rm-status-bar') as HTMLElement | null
    expect(bar?.style.display).toBe('none')
  })
})

describe('post-load aspect ratio refinement', () => {
  it('upgrades a wide-and-short content image to logo class after onLoad fires', async () => {
    const { container } = renderMd('![wide banner](https://example.com/banner.png)')
    let img = container.querySelector('img')!

    // Simulate a wide-and-short image loading (JSDOM doesn't actually load images)
    Object.defineProperty(img, 'naturalWidth',  { value: 500, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 40,  configurable: true })
    act(() => {
      img.dispatchEvent(new Event('load'))
    })

    // After the state update, re-query the img (ReactMarkdown replaces the DOM node on rerender)
    await waitFor(() => {
      img = container.querySelector('img')!
      expect(img.className).toContain('rm-img-logo')
    })
  })

  it('does NOT upgrade a tall image after onLoad', () => {
    const { container } = renderMd('![diagram](https://example.com/diagram.png)')
    let img = container.querySelector('img')!
    Object.defineProperty(img, 'naturalWidth',  { value: 600, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true })
    act(() => {
      img.dispatchEvent(new Event('load'))
    })
    img = container.querySelector('img')!
    expect(img.className).not.toContain('rm-img-logo')
  })
})

describe('badge image rendering', () => {
  it('renders shields.io badge images with rm-img-badge class', () => {
    const { container } = renderMd('![build](https://img.shields.io/npm/v/foo)')
    const img = container.querySelector('img')
    expect(img?.className).toBe('rm-img-badge')
  })

  it('does not apply rm-img-badge to non-badge images', () => {
    const { container } = renderMd('![screenshot](https://example.com/screenshot.png)')
    const img = container.querySelector('img')
    expect(img?.className).not.toBe('rm-img-badge')
  })

  it('rewrites shields.io img src to badge:// scheme', () => {
    const { container } = renderMd('![build](https://img.shields.io/npm/v/foo)')
    const img = container.querySelector('img')
    // getAttribute returns the raw prop value before JSDOM URL normalisation
    expect(img?.getAttribute('src')).toMatch(/^badge:\/\//)
  })
})

describe('badge row paragraph detection', () => {
  it('applies rm-badge-row class to a paragraph of only badge images', () => {
    const md =
      '[![build](https://img.shields.io/npm/v/foo)](https://npmjs.com) ' +
      '[![ci](https://img.shields.io/github/actions/workflow/status/foo/bar/ci.yml)](https://github.com)'
    const { container } = renderMd(md)
    const p = container.querySelector('p')
    expect(p?.className).toBe('rm-badge-row')
  })

  it('does not apply rm-badge-row when paragraph has mixed text and badge', () => {
    const { container } = renderMd('Some text ![build](https://img.shields.io/npm/v/foo)')
    const p = container.querySelector('p')
    expect(p?.className).not.toBe('rm-badge-row')
  })

  it('uses rm-logo-row (not rm-badge-row) for linked non-badge images', () => {
    const { container } = renderMd('[![logo](https://example.com/logo.png)](https://example.com)')
    const p = container.querySelector('p')
    expect(p?.className).toBe('rm-logo-row')
  })
})

describe('content width wrapper', () => {
  it('wraps markdown output in rm-content div', () => {
    const { container } = renderMd('# Hello')
    const wrapper = container.querySelector('.rm-content')
    expect(wrapper).toBeTruthy()
    expect(wrapper?.querySelector('h1')).toBeTruthy()
  })

  it('does not wrap lightbox or status bar in rm-content', () => {
    const { container } = renderMd('# Hello')
    const wrapper = container.querySelector('.rm-content')
    expect(wrapper?.querySelector('.rm-status-bar')).toBeFalsy()
  })
})

// ── YouTube video embed ──────────────────────────────────────────────

describe('YouTube link detection', () => {
  it('renders a YouTube watch link with a play button', () => {
    const { container } = renderMd('[My Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)')
    const btn = container.querySelector('.rm-yt-play-btn')
    expect(btn).not.toBeNull()
    expect(btn?.getAttribute('aria-label')).toBe('Play video')
  })

  it('renders a YouTube shorts link with a play button', () => {
    const { container } = renderMd('[Short](https://www.youtube.com/shorts/dQw4w9WgXcQ)')
    const btn = container.querySelector('.rm-yt-play-btn')
    expect(btn).not.toBeNull()
  })

  it('renders a youtu.be short link with a play button', () => {
    const { container } = renderMd('[Video](https://youtu.be/dQw4w9WgXcQ)')
    const btn = container.querySelector('.rm-yt-play-btn')
    expect(btn).not.toBeNull()
  })

  it('renders a YouTube /embed/ link with a play button', () => {
    const { container } = renderMd('[Video](https://www.youtube.com/embed/dQw4w9WgXcQ)')
    const btn = container.querySelector('.rm-yt-play-btn')
    expect(btn).not.toBeNull()
  })

  it('does NOT add a play button to non-YouTube links', () => {
    const { container } = renderMd('[link](https://example.com/page)')
    const btn = container.querySelector('.rm-yt-play-btn')
    expect(btn).toBeNull()
  })

  it('does NOT add a play button to playlist-only YouTube links', () => {
    const { container } = renderMd('[Playlist](https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxx)')
    const btn = container.querySelector('.rm-yt-play-btn')
    expect(btn).toBeNull()
  })

  it('does NOT add a play button for malformed short video IDs', () => {
    const { container } = renderMd('[Bad](https://www.youtube.com/watch?v=short)')
    const btn = container.querySelector('.rm-yt-play-btn')
    expect(btn).toBeNull()
  })

  it('renders play buttons for multiple YouTube links in one paragraph', () => {
    const md = '[A](https://www.youtube.com/watch?v=aaaaaaaaaaa) and [B](https://www.youtube.com/watch?v=bbbbbbbbbbb)'
    const { container } = renderMd(md)
    const btns = container.querySelectorAll('.rm-yt-play-btn')
    expect(btns.length).toBe(2)
  })

  it('does NOT convert YouTube links to footnotes', () => {
    const { container } = renderMd('[My Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)')
    // Should NOT have a footnote superscript for this link
    const sup = container.querySelector('sup')
    expect(sup).toBeNull()
    // Should still have the original <a> element
    const link = container.querySelector('.rm-yt-link')
    expect(link).not.toBeNull()
  })
})

describe('image-only links', () => {
  it('image-only links get data-img-only stamped and no link preview popover', async () => {
    const { container } = renderMd(
      '[![badge](https://img.shields.io/badge/test-passing-green)](https://example.com)'
    )
    // The <a> wrapping the image should carry data-img-only
    const link = container.querySelector('a[data-img-only]')
    expect(link).toBeTruthy()
  })
})

describe('YouTube theatre mode', () => {
  it('shows theatre iframe when play button is clicked', async () => {
    const { container } = renderMd('[Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)')
    const btn = container.querySelector('.rm-yt-play-btn') as HTMLButtonElement
    act(() => { btn.click() })
    await waitFor(() => {
      const theatre = container.querySelector('.rm-yt-theatre')
      expect(theatre).not.toBeNull()
      const iframe = theatre?.querySelector('iframe')
      expect(iframe?.src).toContain('youtube.com/embed/dQw4w9WgXcQ')
    })
  })

  it('removes theatre iframe when stop button is clicked', async () => {
    const { container } = renderMd('[Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)')
    const btn = container.querySelector('.rm-yt-play-btn') as HTMLButtonElement
    // Play
    act(() => { btn.click() })
    await waitFor(() => {
      expect(container.querySelector('.rm-yt-theatre')).not.toBeNull()
    })
    // Stop — re-query the button since it re-rendered
    const stopBtn = container.querySelector('.rm-yt-play-btn') as HTMLButtonElement
    act(() => { stopBtn.click() })
    await waitFor(() => {
      expect(container.querySelector('.rm-yt-theatre')).toBeNull()
    })
  })

  it('toggles play button aria-label between Play and Stop', async () => {
    const { container } = renderMd('[Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)')
    const btn = container.querySelector('.rm-yt-play-btn') as HTMLButtonElement
    expect(btn.getAttribute('aria-label')).toBe('Play video')
    act(() => { btn.click() })
    await waitFor(() => {
      const btn2 = container.querySelector('.rm-yt-play-btn') as HTMLButtonElement
      expect(btn2.getAttribute('aria-label')).toBe('Stop video')
    })
  })

  it('only allows one video playing at a time', async () => {
    const md = [
      '[Video A](https://www.youtube.com/watch?v=aaaaaaaaaaa)',
      '',
      '[Video B](https://www.youtube.com/watch?v=bbbbbbbbbbb)',
    ].join('\n')
    const { container } = renderMd(md)
    const btns = container.querySelectorAll('.rm-yt-play-btn') as NodeListOf<HTMLButtonElement>
    expect(btns.length).toBe(2)

    // Play video A
    act(() => { btns[0].click() })
    await waitFor(() => {
      expect(container.querySelectorAll('.rm-yt-theatre').length).toBe(1)
      expect(container.querySelector('iframe')?.src).toContain('aaaaaaaaaaa')
    })

    // Play video B — should replace A
    const btns2 = container.querySelectorAll('.rm-yt-play-btn') as NodeListOf<HTMLButtonElement>
    act(() => { btns2[1].click() })
    await waitFor(() => {
      expect(container.querySelectorAll('.rm-yt-theatre').length).toBe(1)
      expect(container.querySelector('iframe')?.src).toContain('bbbbbbbbbbb')
    })
  })
})

describe('link preview popover', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('external link renders <a> without popover before hover', () => {
    const { container } = render(
      <MemoryRouter>
        <ReadmeRenderer content={'[visit](https://example.com)'} repoOwner="o" repoName="r" branch="main" />
      </MemoryRouter>
    )
    expect(container.querySelector('.rm-link-popover')).toBeNull()
  })

  it('popover appears after 300ms hover on external link', async () => {
    const { container } = render(
      <MemoryRouter>
        <ReadmeRenderer content={'[visit](https://example.com)'} repoOwner="o" repoName="r" branch="main" />
      </MemoryRouter>
    )
    // Use :not(.rm-reference-url) to select the inline link, not the reference-list URL
    const link = container.querySelector('a.rm-link:not(.rm-reference-url)')!
    fireEvent.mouseEnter(link)
    await vi.advanceTimersByTimeAsync(300)
    // flush micro-tasks: timer callback → fetchLinkPreview awaits → React state update
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    // Popover is portalled to document.body to escape backdrop-filter containing blocks
    expect(document.body.querySelector('.rm-link-popover')).not.toBeNull()
  })

  it('popover disappears 80ms after mouse leaves', async () => {
    const { container } = render(
      <MemoryRouter>
        <ReadmeRenderer content={'[visit](https://example.com)'} repoOwner="o" repoName="r" branch="main" />
      </MemoryRouter>
    )
    const link = container.querySelector('a.rm-link:not(.rm-reference-url)')!
    fireEvent.mouseEnter(link)
    await vi.advanceTimersByTimeAsync(300)
    // flush micro-tasks: timer callback → fetchLinkPreview awaits → React state update
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    fireEvent.mouseLeave(link)
    await vi.advanceTimersByTimeAsync(80)
    expect(container.querySelector('.rm-link-popover')).toBeNull()
  })

  it('mouse leave before 300ms prevents popover from appearing', async () => {
    const { container } = render(
      <MemoryRouter>
        <ReadmeRenderer content={'[visit](https://example.com)'} repoOwner="o" repoName="r" branch="main" />
      </MemoryRouter>
    )
    const link = container.querySelector('a.rm-link:not(.rm-reference-url)')!
    fireEvent.mouseEnter(link)
    await vi.advanceTimersByTimeAsync(100)  // leave before 300ms
    fireEvent.mouseLeave(link)
    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()
    expect(container.querySelector('.rm-link-popover')).toBeNull()
  })

  it('relative and anchor links do not get popover', async () => {
    const { container } = render(
      <MemoryRouter>
        <ReadmeRenderer content={'[local](#section) [rel](/path)'} repoOwner="o" repoName="r" branch="main" />
      </MemoryRouter>
    )
    const links = container.querySelectorAll('a')
    for (const link of links) {
      fireEvent.mouseEnter(link)
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
    }
    expect(container.querySelector('.rm-link-popover')).toBeNull()
  })

  it('youtube links do not trigger link preview popover', async () => {
    const { container } = render(
      <MemoryRouter>
        <ReadmeRenderer
          content={'[watch](https://www.youtube.com/watch?v=dQw4w9WgXcQ)'}
          repoOwner="o" repoName="r" branch="main"
        />
      </MemoryRouter>
    )
    const link = container.querySelector('a[data-yt-id]')!
    fireEvent.mouseEnter(link)
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()
    expect(container.querySelector('.rm-link-popover')).toBeNull()
  })

  it('popover shows title and domain from fetched data', async () => {
    const { container } = render(
      <MemoryRouter>
        <ReadmeRenderer content={'[visit](https://example.com)'} repoOwner="o" repoName="r" branch="main" />
      </MemoryRouter>
    )
    const link = container.querySelector('a.rm-link:not(.rm-reference-url)')!
    fireEvent.mouseEnter(link)
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    // Popover is portalled to document.body to escape backdrop-filter containing blocks
    expect(document.body.querySelector('.rm-link-popover-title')?.textContent).toBe('Test Page')
    expect(document.body.querySelector('.rm-link-popover-domain')?.textContent).toBe('example.com')
  })

  it('popover with empty fields shows URL row only (no title or description)', async () => {
    // Override the mock to return empty data
    ;(window.api.linkPreview.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      title: '', description: '', imageUrl: '', faviconUrl: '', domain: 'example.com',
    })
    const { container } = render(
      <MemoryRouter>
        <ReadmeRenderer content={'[visit](https://example.com/empty)'} repoOwner="o" repoName="r" branch="main" />
      </MemoryRouter>
    )
    const link = container.querySelector('a.rm-link:not(.rm-reference-url)')!
    fireEvent.mouseEnter(link)
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    // Popover is portalled to document.body to escape backdrop-filter containing blocks
    expect(document.body.querySelector('.rm-link-popover-title')).toBeNull()
    expect(document.body.querySelector('.rm-link-popover-url')).not.toBeNull()
  })

  it('mouse enter on popover cancels the dismiss timer', async () => {
    const { container } = render(
      <MemoryRouter>
        <ReadmeRenderer content={'[visit](https://example.com)'} repoOwner="o" repoName="r" branch="main" />
      </MemoryRouter>
    )
    const link = container.querySelector('a.rm-link:not(.rm-reference-url)')!
    fireEvent.mouseEnter(link)
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    // Now leave the link — starts 80ms dismiss timer
    fireEvent.mouseLeave(link)
    // Enter the popover before timer fires (portalled to document.body)
    const popover = document.body.querySelector('.rm-link-popover')!
    fireEvent.mouseEnter(popover)
    await vi.advanceTimersByTimeAsync(200)  // well past 80ms
    // Popover should still be visible
    expect(document.body.querySelector('.rm-link-popover')).not.toBeNull()
  })

  it('rapid hover A→B: only B popover shows when A fetch resolves late', async () => {
    let resolveA!: (v: LinkPreviewResult) => void
    const fetchMock = window.api.linkPreview.fetch as ReturnType<typeof vi.fn>
    // First call (for A) returns a promise we control
    fetchMock.mockImplementationOnce(() => new Promise(r => { resolveA = r }))
    // Second call (for B) resolves immediately
    fetchMock.mockResolvedValueOnce({ title: 'B Page', description: '', imageUrl: '', faviconUrl: '', domain: 'b.com' })

    const { container } = render(
      <MemoryRouter>
        <ReadmeRenderer
          content={'[A](https://a.com) [B](https://b.com)'}
          repoOwner="o" repoName="r" branch="main"
        />
      </MemoryRouter>
    )
    // Use :not(.rm-reference-url) to select only inline links (not reference-list URLs)
    const [linkA, linkB] = container.querySelectorAll('a.rm-link:not(.rm-reference-url)')

    // Hover A, wait for debounce, fetch starts but doesn't resolve yet
    fireEvent.mouseEnter(linkA)
    await vi.advanceTimersByTimeAsync(300)

    // Move to B — A's fetch is still pending
    fireEvent.mouseLeave(linkA)
    fireEvent.mouseEnter(linkB)
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()  // B's fetch resolves
    await Promise.resolve()
    await Promise.resolve()

    // B's popover should be showing (portalled to document.body)
    expect(document.body.querySelector('.rm-link-popover-domain')?.textContent).toBe('b.com')

    // Now resolve A's fetch late — should NOT replace B's popover
    resolveA({ title: 'A Page', description: '', imageUrl: '', faviconUrl: '', domain: 'a.com' })
    await Promise.resolve()
    expect(document.body.querySelector('.rm-link-popover-domain')?.textContent).toBe('b.com')
  })
})

describe('GitHub repo link behaviour', () => {
  it('renders with data-gh-owner, data-gh-name, and rm-gh-repo-link class', () => {
    const { container } = renderMd('[react](https://github.com/facebook/react)')
    const link = container.querySelector('a[data-gh-owner]') as HTMLAnchorElement | null
    expect(link).not.toBeNull()
    expect(link?.getAttribute('data-gh-owner')).toBe('facebook')
    expect(link?.getAttribute('data-gh-name')).toBe('react')
    expect(link?.className).toContain('rm-gh-repo-link')
  })

  it('is NOT converted to a footnote — no .rm-references section', () => {
    const { container } = renderMd('[react](https://github.com/facebook/react)')
    expect(container.querySelector('.rm-references')).toBeNull()
  })

  it('does NOT call openExternal on click', () => {
    const { container } = renderMd('[react](https://github.com/facebook/react)')
    const link = container.querySelector('a[data-gh-owner]') as HTMLAnchorElement
    act(() => { link.click() })
    expect(window.api.openExternal).not.toHaveBeenCalled()
  })

  it('non-repo GitHub link is still converted to footnote', () => {
    const { container } = renderMd('[issue](https://github.com/facebook/react/issues/1)')
    expect(container.querySelector('.rm-references')).not.toBeNull()
  })

  it('does not call linkPreview.fetch for a data-gh-owner link', async () => {
    const { container } = renderMd('[react](https://github.com/facebook/react)')
    // Advance timers to let any prefetch fire
    await act(async () => { await Promise.resolve() })
    // linkPreview.fetch should never be called for this URL
    expect(window.api.linkPreview.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('github.com/facebook/react')
    )
  })

  describe('hover popover', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('shows popover after 300ms hover with repo name', async () => {
      ;(window.api.repo.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: '1', owner: 'facebook', name: 'react',
        description: 'A JS library', stars: 200000, avatar_url: '',
        language: null, topics: '[]', forks: null, license: null,
        readme: null, pushed_at: null, homepage: null,
      })
      const { container } = renderMd('[react](https://github.com/facebook/react)')
      const link = container.querySelector('a[data-gh-owner]')!
      fireEvent.mouseEnter(link)
      await vi.advanceTimersByTimeAsync(300)
      // flush micro-tasks: timer callback → fetchRepoPreview awaits → React state update
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      // Popover is portalled to document.body to escape backdrop-filter containing blocks
      expect(document.body.querySelector('.rm-gh-repo-popover')).not.toBeNull()
      expect(document.body.querySelector('.rm-gh-repo-popover-name')?.textContent).toBe('facebook/react')
    })

    it('hides popover 80ms after mouse leaves', async () => {
      ;(window.api.repo.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: '1', owner: 'facebook', name: 'react',
        description: '', stars: 0, avatar_url: '',
        language: null, topics: '[]', forks: null, license: null,
        readme: null, pushed_at: null, homepage: null,
      })
      const { container } = renderMd('[react](https://github.com/facebook/react)')
      const link = container.querySelector('a[data-gh-owner]')!
      fireEvent.mouseEnter(link)
      await vi.advanceTimersByTimeAsync(300)
      // flush micro-tasks: timer callback → fetchRepoPreview awaits → React state update
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      fireEvent.mouseLeave(link)
      await vi.advanceTimersByTimeAsync(80)
      expect(container.querySelector('.rm-gh-repo-popover')).toBeNull()
    })
  })
})
