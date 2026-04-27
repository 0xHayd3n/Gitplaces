import '@testing-library/jest-dom'

// jsdom does not implement ResizeObserver; provide a no-op stub so
// components that use it (e.g. Discover container-width tracking) don't throw.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  })
}

// jsdom does not implement IntersectionObserver; provide a stub that immediately
// fires with isIntersecting: true so ViewportWindow reveals its children in tests.
if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  class IntersectionObserverStub {
    private cb: IntersectionObserverCallback
    constructor(cb: IntersectionObserverCallback) { this.cb = cb }
    observe(target: Element) {
      // Fire immediately so ViewportWindow renders its children
      this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    }
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: IntersectionObserverStub,
  })
}

// jsdom does not implement speechSynthesis; provide a no-op stub so
// components that use it (e.g. ReadmeRenderer TTS) don't throw.
if (typeof window !== 'undefined' && !window.speechSynthesis) {
  Object.defineProperty(window, 'speechSynthesis', {
    writable: true,
    configurable: true,
    value: {
      getVoices: () => [],
      speak: () => {},
      cancel: () => {},
      pause: () => {},
      resume: () => {},
      onvoiceschanged: null,
      speaking: false,
      pending: false,
      paused: false,
    },
  })
}

// Stub HTMLMediaElement methods that jsdom doesn't implement
if (typeof window !== 'undefined') {
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value() {},
  })
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value() { return Promise.resolve() },
  })
}

// Stub window.api.tts for TTS hook tests
if (typeof window !== 'undefined' && !(window as any).api?.tts) {
  const api = (window as any).api ?? {}
  api.tts = {
    synthesize: async () => ({ audio: new ArrayBuffer(0), wordBoundaries: [] }),
    getVoices: async () => [
      { shortName: 'en-US-AriaNeural', label: 'Aria (Female)' },
    ],
    checkAvailable: async () => false,
  }
  api.settings = api.settings ?? {
    get: async () => null,
    set: async () => {},
  }
  if (!(window as any).api) {
    Object.defineProperty(window, 'api', {
      value: api,
      writable: true,
      configurable: true,
    })
  }
}
