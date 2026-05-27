import { createPortal } from 'react-dom'
import logoTransparent from '../assets/logo-transparent.png'

/**
 * Custom min/max/close rendered as three rounded buttons styled to match
 * the Discover filter buttons (.dtn-filter-btn). Portalled to document.body
 * so they live outside every stacking context and stay clickable across all
 * views.
 *
 * The <header className="titlebar"> remains in-tree as the drag region and
 * layout spacer.
 */
export default function Titlebar() {
  const { minimize, maximize, close } = window.api.windowControls

  return (
    <>
      <header className="titlebar">
        <div className="titlebar-left">
          <img src={logoTransparent} alt="GitSuite" className="titlebar-logo" />
        </div>
      </header>
      {createPortal(
        <div className="titlebar-controls">
          <button
            data-testid="ctrl-minimize"
            className="titlebar-ctrl titlebar-ctrl-minimize"
            onClick={minimize}
            aria-label="Minimize"
            title="Minimize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
            </svg>
          </button>
          <button
            data-testid="ctrl-maximize"
            className="titlebar-ctrl titlebar-ctrl-maximize"
            onClick={maximize}
            aria-label="Maximize"
            title="Maximize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            data-testid="ctrl-close"
            className="titlebar-ctrl titlebar-ctrl-close"
            onClick={close}
            aria-label="Close"
            title="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
              <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
            </svg>
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
