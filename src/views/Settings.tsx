import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useAppearance, type BackgroundMode } from '../contexts/Appearance'
import AIPanel from './settings/AIPanel'
import ConnectorsPanel from './settings/ConnectorsPanel'
import AIIcon from './settings/shared/AIIcon'

type CategoryId = 'ai' | 'appearance' | 'language' | 'downloads' | 'projects' | 'connectors' | 'updates'

const BACKGROUND_OPTIONS: { value: BackgroundMode; label: string }[] = [
  { value: 'none', label: 'Default' },
  { value: 'dither', label: 'Dithered' },
]

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const PaletteIcon = () => (
  <svg {...iconProps}>
    <path d="M8 1.5C4.4 1.5 1.5 4.4 1.5 8s2.9 6.5 6.5 6.5c.8 0 1.3-.6 1.3-1.3 0-.3-.1-.6-.3-.9-.2-.3-.3-.5-.3-.8 0-.7.6-1.3 1.3-1.3h1.5c2.2 0 4-1.8 4-4 0-3.1-2.9-6.2-6.5-6.2Z" />
    <circle cx="4.5" cy="7.2" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="6.8" cy="4.4" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="10" cy="4.4" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7.2" r="0.7" fill="currentColor" stroke="none" />
  </svg>
)

const GlobeIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="6.5" />
    <ellipse cx="8" cy="8" rx="2.6" ry="6.5" />
    <path d="M1.5 8h13" />
  </svg>
)

const DownloadIcon = () => (
  <svg {...iconProps}>
    <path d="M8 2v8.5 M4.5 7l3.5 3.5L11.5 7 M2.5 13.5h11" />
  </svg>
)

const ProjectsIcon = () => (
  <svg {...iconProps}>
    <path d="M2.5 5.5h11 M2.5 8h11 M2.5 10.5h7" />
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
  </svg>
)

const ConnectorsIcon = () => (
  <svg {...iconProps}>
    <circle cx="3.5" cy="8" r="2" />
    <circle cx="12.5" cy="8" r="2" />
    <path d="M5.5 8h3.5 M7 6l2 2-2 2" />
  </svg>
)

const UpdatesIcon = () => (
  <svg {...iconProps}>
    <path d="M8 3v6 M5 6l3-3 3 3" />
    <path d="M3.5 10a5.5 5.5 0 1 0 9.5-3.8" />
  </svg>
)

const CATEGORIES: { id: CategoryId; label: string; icon: ReactNode }[] = [
  { id: 'ai',         label: 'AI',               icon: <AIIcon /> },
  { id: 'appearance', label: 'Appearance',        icon: <PaletteIcon /> },
  { id: 'language',   label: 'Language & Speech', icon: <GlobeIcon /> },
  { id: 'downloads',  label: 'Downloads',         icon: <DownloadIcon /> },
  { id: 'projects',   label: 'Projects',          icon: <ProjectsIcon /> },
  { id: 'connectors', label: 'Connectors',        icon: <ConnectorsIcon /> },
  { id: 'updates',    label: 'Updates',           icon: <UpdatesIcon /> },
]

export default function Settings() {
  const { background, setBackground, invertDarkImages, setInvertDarkImages } = useAppearance()
  const [activeCategory, setActiveCategory] = useState<CategoryId>('ai')
  const [preferredLanguage, setPreferredLanguage] = useState('en')
  const [downloadFolder, setDownloadFolder] = useState<string>('')
  const [defaultDownloadFolder, setDefaultDownloadFolder] = useState<string>('')
  const [projectsFolder, setProjectsFolder] = useState<string>('')

  // TTS voice state
  const [ttsVoices, setTtsVoices] = useState<{ shortName: string; label: string }[]>([])
  const [ttsVoice, setTtsVoice] = useState<string>('')
  const [ttsPreviewPlaying, setTtsPreviewPlaying] = useState(false)

  // Updates state
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false)
  const [checkIntervalHours, setCheckIntervalHours] = useState(24)
  const [lastCheckedTs, setLastCheckedTs] = useState<number | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [intervalDraft, setIntervalDraft] = useState(String(checkIntervalHours))

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  useEffect(() => {
    window.api.settings.get('autoUpdateEnabled').then(val => {
      setAutoUpdateEnabled(val === 'true')
    }).catch(() => {})
    window.api.settings.get('updateCheckIntervalHours').then(val => {
      if (val) {
        const parsed = parseInt(val, 10) || 24
        setCheckIntervalHours(parsed)
        setIntervalDraft(String(parsed))
      }
    }).catch(() => {})
    window.api.updates.lastChecked().then(({ timestamp }) => {
      setLastCheckedTs(timestamp)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    window.api.settings.getPreferredLanguage().then(setPreferredLanguage).catch(() => {})
    window.api.download.getDefaultFolder().then((val: string) => {
      setDefaultDownloadFolder(val)
    })
    window.api.settings.get('downloadFolder').then((val: string | null) => {
      setDownloadFolder(val ?? '')
    })
    window.api.settings.get('projectsFolder').then((val: string | null) => {
      setProjectsFolder(val ?? '')
    })
    window.api.tts.getVoices().then((voices: { shortName: string; label: string }[]) => {
      setTtsVoices(voices)
      if (voices.length > 0) {
        window.api.settings.get('tts_voice').then((saved: string | null) => {
          setTtsVoice(saved && voices.some(v => v.shortName === saved) ? saved : voices[0].shortName)
        })
      }
    }).catch(() => {})
  }, [])

  const handleAutoUpdateToggle = useCallback(async (enabled: boolean) => {
    setAutoUpdateEnabled(enabled)
    await window.api.settings.set('autoUpdateEnabled', enabled ? 'true' : 'false')
  }, [])

  const handleIntervalChange = useCallback(async (hours: number) => {
    const clamped = Math.min(168, Math.max(1, hours))
    setCheckIntervalHours(clamped)
    setIntervalDraft(String(clamped))
    await window.api.settings.set('updateCheckIntervalHours', String(clamped))
    await window.api.updates.restartService()
  }, [])

  const handleCheckNow = useCallback(async () => {
    setUpdateChecking(true)
    try {
      await window.api.updates.checkNow()
      const { timestamp } = await window.api.updates.lastChecked()
      setLastCheckedTs(timestamp)
    } finally {
      setUpdateChecking(false)
    }
  }, [])

  const handleChangeFolder = async () => {
    const result = await window.api.download.pickFolder()
    if (result) {
      await window.api.settings.set('downloadFolder', result)
      setDownloadFolder(result)
    }
  }

  const handleResetFolder = async () => {
    await window.api.settings.set('downloadFolder', '')
    setDownloadFolder('')
  }

  const handleChangeProjectsFolder = async () => {
    const result = await window.api.download.pickFolder()
    if (result) {
      await window.api.settings.set('projectsFolder', result)
      setProjectsFolder(result)
    }
  }

  const handleClearProjectsFolder = async () => {
    await window.api.settings.set('projectsFolder', '')
    setProjectsFolder('')
  }

  const savePreferredLanguage = async (lang: string) => {
    setPreferredLanguage(lang)
    await window.api.settings.setPreferredLanguage(lang)
  }

  const saveTtsVoice = async (voice: string) => {
    setTtsVoice(voice)
    await window.api.settings.set('tts_voice', voice)
  }

  const handleTtsPreview = async () => {
    if (ttsPreviewPlaying) return
    setTtsPreviewPlaying(true)
    try {
      const result = await window.api.tts.synthesize(
        'Hello, this is a preview of the selected voice.',
        ttsVoice,
      )
      const blob = new Blob([result.audio], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => {
        URL.revokeObjectURL(url)
        setTtsPreviewPlaying(false)
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        setTtsPreviewPlaying(false)
      }
      await audio.play()
    } catch {
      setTtsPreviewPlaying(false)
    }
  }

  const renderAppearance = () => (
    <>
      <div className="settings-group">
        <div className="settings-group-title">Theme</div>
        <div className="settings-group-body">
          <div className="settings-group-row settings-group-row--full">
            <div className="settings-group-row-label">Dark by design</div>
            <p className="settings-hint" style={{ marginTop: 4 }}>
              Git Suite is a dark-only app. The palette is tuned for long sessions
              reading code and READMEs; a light mode isn&rsquo;t planned.
            </p>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Background</div>
        <div className="settings-group-body">
          <div className="settings-group-row settings-group-row--full">
            <p className="settings-hint" style={{ marginBottom: 12 }}>
              Choose the wallpaper shown behind the app.
            </p>
            <div className="bg-picker" role="radiogroup" aria-label="Background style">
              {BACKGROUND_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={background === opt.value}
                  className={`bg-picker-option${background === opt.value ? ' selected' : ''}`}
                  onClick={() => setBackground(opt.value)}
                >
                  <div className={`bg-picker-preview bg-picker-preview--${opt.value}`} />
                  <div className="bg-picker-label">{opt.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Images</div>
        <div className="settings-group-body">
          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Invert dark images</div>
              <div className="settings-group-row-sub">
                Automatically inverts logos and banners with dark content so they&rsquo;re readable on dark backgrounds.
              </div>
            </div>
            <input
              type="checkbox"
              checked={invertDarkImages}
              onChange={(e) => setInvertDarkImages(e.target.checked)}
              aria-label="Invert dark images"
            />
          </div>
        </div>
      </div>
    </>
  )

  const renderLanguage = () => (
    <>
      <div className="settings-group">
        <div className="settings-group-title">Language</div>
        <div className="settings-group-body">
          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Preferred language</div>
              <div className="settings-group-row-sub">
                Repo descriptions and READMEs in other languages will be automatically translated.
              </div>
            </div>
            <select
              className="settings-select"
              value={preferredLanguage}
              onChange={e => savePreferredLanguage(e.target.value)}
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="pt">Portuguese</option>
              <option value="it">Italian</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese (Simplified)</option>
              <option value="ru">Russian</option>
              <option value="ar">Arabic</option>
              <option value="hi">Hindi</option>
              <option value="nl">Dutch</option>
              <option value="pl">Polish</option>
              <option value="tr">Turkish</option>
              <option value="vi">Vietnamese</option>
              <option value="id">Indonesian</option>
              <option value="sv">Swedish</option>
            </select>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Text-to-Speech</div>
        <div className="settings-group-body">
          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Voice</div>
              <div className="settings-group-row-sub">
                Requires internet connection. Falls back to browser voice when offline.
              </div>
            </div>
            <div className="settings-select-row">
              <select
                className="settings-select"
                value={ttsVoice}
                onChange={e => saveTtsVoice(e.target.value)}
              >
                {ttsVoices.map(v => (
                  <option key={v.shortName} value={v.shortName}>{v.label}</option>
                ))}
              </select>
              <button
                className="settings-btn"
                onClick={handleTtsPreview}
                disabled={ttsPreviewPlaying || !ttsVoice}
              >
                {ttsPreviewPlaying ? 'Playing…' : 'Preview'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )

  const renderDownloads = () => (
    <div className="settings-group">
      <div className="settings-group-title">Download location</div>
      <div className="settings-group-body">
        <div className="settings-group-row settings-group-row--full">
          <div className="settings-group-row-label">Folder</div>
          <div className="settings-group-row-sub" style={{ marginTop: 4 }}>
            Where downloaded repository ZIP files are saved.
          </div>
          <div className="settings-inline-row" style={{ marginTop: 10 }}>
            <span className="settings-path">
              {downloadFolder || defaultDownloadFolder || 'Loading…'}
            </span>
            <button className="settings-btn" onClick={handleChangeFolder}>Change</button>
            {downloadFolder && (
              <button className="settings-btn settings-btn--link" onClick={handleResetFolder}>
                Reset to default
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const renderProjects = () => (
    <div className="settings-group">
      <div className="settings-group-title">Projects folder</div>
      <div className="settings-group-body">
        <div className="settings-group-row settings-group-row--full">
          <div className="settings-group-row-label">Folder</div>
          <div className="settings-group-row-sub" style={{ marginTop: 4 }}>
            Local folders inside this directory are scanned and shown as projects in the Projects view. Git repos with a GitHub remote link directly to the repository.
          </div>
          <div className="settings-inline-row" style={{ marginTop: 10 }}>
            <span className="settings-path">
              {projectsFolder || 'No folder selected'}
            </span>
            <button className="settings-btn" onClick={handleChangeProjectsFolder}>
              {projectsFolder ? 'Change' : 'Choose folder'}
            </button>
            {projectsFolder && (
              <button className="settings-btn settings-btn--link" onClick={handleClearProjectsFolder}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const renderUpdates = () => (
    <>
      <div className="settings-group">
        <div className="settings-group-title">Update Checks</div>
        <div className="settings-group-body">

          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Auto-update</div>
              {autoUpdateEnabled && (
                <div className="settings-group-row-sub settings-hint-warn">
                  Auto-update for learned repos consumes Claude API credits automatically.
                </div>
              )}
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={autoUpdateEnabled}
                onChange={e => handleAutoUpdateToggle(e.target.checked)}
              />
              <span className="settings-toggle-track" />
            </label>
          </div>

          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Check every (hours)</div>
            </div>
            <input
              type="number"
              className="settings-input-number"
              min={1}
              max={168}
              value={intervalDraft}
              onChange={e => setIntervalDraft(e.target.value)}
              onBlur={() => handleIntervalChange(parseInt(intervalDraft, 10) || 24)}
            />
          </div>

          <div className="settings-group-row">
            <div className="settings-group-row-main">
              <div className="settings-group-row-label">Last checked</div>
              <div className="settings-group-row-sub">
                {lastCheckedTs
                  ? (() => {
                      const diff = Math.floor((Date.now() / 1000 - lastCheckedTs) / 60)
                      if (diff < 1) return 'Just now'
                      if (diff < 60) return `${diff} minute${diff !== 1 ? 's' : ''} ago`
                      const h = Math.floor(diff / 60)
                      return `${h} hour${h !== 1 ? 's' : ''} ago`
                    })()
                  : 'Never'}
              </div>
            </div>
            <button
              className="settings-btn"
              onClick={handleCheckNow}
              disabled={updateChecking}
            >
              {updateChecking ? 'Checking…' : 'Check now'}
            </button>
          </div>

        </div>
      </div>
    </>
  )

  const activeLabel = CATEGORIES.find(c => c.id === activeCategory)?.label ?? ''

  return (
    <div className="settings-view">
      <aside className="settings-sidebar">
        <h1 className="settings-title">Settings</h1>
        <nav className="settings-nav" aria-label="Settings categories">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              type="button"
              className={`settings-nav-item${activeCategory === cat.id ? ' active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
              aria-current={activeCategory === cat.id ? 'page' : undefined}
            >
              <span className="settings-nav-icon">{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="settings-content">
        <div key={activeCategory} className="settings-pane">
          <h2 className="settings-pane-title">{activeLabel}</h2>
          {activeCategory === 'ai'         && <AIPanel />}
          {activeCategory === 'appearance' && renderAppearance()}
          {activeCategory === 'language'   && renderLanguage()}
          {activeCategory === 'downloads'  && renderDownloads()}
          {activeCategory === 'projects'   && renderProjects()}
          {activeCategory === 'connectors' && <ConnectorsPanel />}
          {activeCategory === 'updates'    && renderUpdates()}
        </div>
      </main>
    </div>
  )
}
