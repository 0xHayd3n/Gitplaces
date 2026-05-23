import { applyHarmony, type HarmonyMode } from '../utils/colorHarmony'

export interface AgentColorPickerProps {
  mode: 'solid' | 'gradient'
  colorStart: string
  colorEnd: string | null
  harmony: HarmonyMode
  onChange: (next: { mode: 'solid' | 'gradient'; colorStart: string; colorEnd: string | null; harmony: HarmonyMode }) => void
}

const HARMONIES: { mode: HarmonyMode; label: string }[] = [
  { mode: 'manual',        label: 'Manual' },
  { mode: 'mono',          label: 'Monochromatic' },
  { mode: 'analogous',     label: 'Analogous' },
  { mode: 'complementary', label: 'Complementary' },
  { mode: 'split',         label: 'Split-complementary' },
  { mode: 'triadic',       label: 'Triadic' },
  { mode: 'tetradic',      label: 'Tetradic' },
]

export default function AgentColorPicker(props: AgentColorPickerProps) {
  const { mode, colorStart, colorEnd, harmony, onChange } = props

  const setMode = (next: 'solid' | 'gradient') => {
    if (next === mode) return
    if (next === 'solid') {
      onChange({ mode: 'solid', colorStart, colorEnd: null, harmony: 'manual' })
    } else {
      const initialHarmony: HarmonyMode = 'complementary'
      onChange({
        mode: 'gradient',
        colorStart,
        colorEnd: applyHarmony(colorStart, initialHarmony),
        harmony: initialHarmony,
      })
    }
  }

  const setColorStart = (next: string) => {
    if (mode === 'gradient' && harmony !== 'manual') {
      onChange({ mode, colorStart: next, colorEnd: applyHarmony(next, harmony), harmony })
    } else {
      onChange({ mode, colorStart: next, colorEnd, harmony })
    }
  }

  const setColorEnd = (next: string) => {
    onChange({ mode, colorStart, colorEnd: next, harmony })
  }

  const setHarmony = (next: HarmonyMode) => {
    if (next === 'manual') {
      onChange({ mode, colorStart, colorEnd, harmony: next })
    } else {
      onChange({ mode, colorStart, colorEnd: applyHarmony(colorStart, next), harmony: next })
    }
  }

  return (
    <div className="agent-color-picker">
      <div className="acp-toggle" role="group" aria-label="Color mode">
        <button
          type="button"
          aria-pressed={mode === 'solid'}
          className={mode === 'solid' ? 'active' : ''}
          onClick={() => setMode('solid')}
        >Solid</button>
        <button
          type="button"
          aria-pressed={mode === 'gradient'}
          className={mode === 'gradient' ? 'active' : ''}
          onClick={() => setMode('gradient')}
        >Gradient</button>
      </div>

      <div className="acp-pickers">
        <label className="acp-color-cell">
          <input
            type="color"
            value={colorStart}
            onChange={e => setColorStart(e.target.value)}
            aria-label="Start color"
          />
        </label>
        <input
          type="text"
          aria-label="Start hex"
          value={colorStart}
          onChange={e => setColorStart(e.target.value)}
          className="acp-hex"
        />

        {mode === 'gradient' && (
          <>
            <span className="acp-arrow">→</span>
            <label className="acp-color-cell">
              <input
                type="color"
                value={colorEnd ?? colorStart}
                onChange={e => setColorEnd(e.target.value)}
                aria-label="End color"
                disabled={harmony !== 'manual'}
              />
            </label>
            <input
              type="text"
              aria-label="End hex"
              value={colorEnd ?? ''}
              onChange={e => setColorEnd(e.target.value)}
              className="acp-hex"
              disabled={harmony !== 'manual'}
            />
          </>
        )}

        <div
          className="acp-preview"
          style={{
            background: mode === 'gradient' && colorEnd
              ? `linear-gradient(135deg, ${colorStart}, ${colorEnd})`
              : colorStart,
          }}
        />
      </div>

      {mode === 'gradient' && (
        <div className="acp-harmonies">
          {HARMONIES.map(h => (
            <button
              key={h.mode}
              type="button"
              className={`acp-harmony${harmony === h.mode ? ' active' : ''}`}
              onClick={() => setHarmony(h.mode)}
            >
              {h.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
