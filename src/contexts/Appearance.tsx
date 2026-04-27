import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type BackgroundMode = 'none' | 'dither'

interface AppearanceContextValue {
  background: BackgroundMode
  setBackground: (value: BackgroundMode) => void
  invertDarkImages: boolean
  setInvertDarkImages: (value: boolean) => void
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [background, setBackgroundState] = useState<BackgroundMode>('none')
  const [invertDarkImages, setInvertDarkImagesState] = useState(false)

  useEffect(() => {
    window.api.settings.get('background').then((val: string | null) => {
      if (val === 'dither' || val === 'none') setBackgroundState(val)
    }).catch(() => {})
    window.api.settings.get('invertDarkImages').then((val: string | null) => {
      if (val === 'true') setInvertDarkImagesState(true)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (invertDarkImages) {
      document.documentElement.classList.add('invert-dark-images')
    } else {
      document.documentElement.classList.remove('invert-dark-images')
    }
  }, [invertDarkImages])

  const setBackground = (value: BackgroundMode) => {
    setBackgroundState(value)
    window.api.settings.set('background', value).catch(() => {})
  }

  const setInvertDarkImages = (value: boolean) => {
    setInvertDarkImagesState(value)
    window.api.settings.set('invertDarkImages', String(value)).catch(() => {})
  }

  return (
    <AppearanceContext.Provider value={{ background, setBackground, invertDarkImages, setInvertDarkImages }}>
      {children}
    </AppearanceContext.Provider>
  )
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext)
  if (!ctx) throw new Error('useAppearance must be used inside AppearanceProvider')
  return ctx
}
