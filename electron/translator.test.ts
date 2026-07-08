import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { detectScriptLanguage, needsTranslation, translate, detectLanguage } from './translator'

describe('detectScriptLanguage', () => {
  it('returns null for text with fewer than 4 letters', () => {
    expect(detectScriptLanguage('hi')).toBeNull()
    expect(detectScriptLanguage('12 3!')).toBeNull()
  })

  it.each<[string, string]>([
    ['これはテストです', 'ja'],
    ['안녕하세요친구', 'ko'],
    ['Привет мир друзья', 'ru'],
    ['مرحبا بالعالم', 'ar'],
    ['नमस्ते दुनिया', 'hi'],
    ['这是一个测试', 'zh'],
    ['this is english text', 'en'],
  ])('detects %s as %s', (text, lang) => {
    expect(detectScriptLanguage(text)).toBe(lang)
  })
})

describe('needsTranslation', () => {
  const longJa = 'これはにほんごでかかれたとてもながいぶんしょうです。'.repeat(9)
  const longEn = 'This is a fairly long english paragraph that describes the project in detail. '.repeat(4)

  it('returns null when the plain text is shorter than the minimum length', () => {
    expect(needsTranslation('これはテスト', 'en')).toBeNull()
  })

  it('returns the detected language when it differs from the target', () => {
    expect(longJa.length).toBeGreaterThanOrEqual(200)
    expect(needsTranslation(longJa, 'en')).toBe('ja')
  })

  it('returns null when the detected language matches the target', () => {
    expect(needsTranslation(longEn, 'en')).toBeNull()
  })

  it('treats language variants (zh vs zh-TW) as the same', () => {
    const longZh = '这是一个用中文写的很长的说明文档内容。'.repeat(8)
    expect(needsTranslation(longZh, 'zh-TW')).toBeNull()
  })

  it('strips markdown before measuring length', () => {
    // Mostly markdown syntax + a short code block → little plain text left → null.
    const md = '# Title\n```\n' + 'x'.repeat(400) + '\n```'
    expect(needsTranslation(md, 'en')).toBeNull()
  })
})

describe('translate / detectLanguage (network-backed)', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  const mockFetch = () => global.fetch as unknown as ReturnType<typeof vi.fn>

  it('translate returns translated text and detected language', async () => {
    mockFetch().mockResolvedValue({
      ok: true,
      json: async () => [[['Hello', 'こんにちは', null, null]], null, 'ja'],
    })
    const res = await translate('こんにちは', 'en')
    expect(res).toEqual({ translatedText: 'Hello', detectedLanguage: 'ja' })
  })

  it('translate preserves fenced/inline code blocks', async () => {
    mockFetch().mockResolvedValue({
      ok: true,
      json: async () => [[['ejecutar CODEBLOCK_0_END ahora', '', null, null]], null, 'es'],
    })
    const res = await translate('run `npm install` now', 'es')
    expect(res?.translatedText).toContain('`npm install`')
  })

  it('translate returns null when a chunk request is not ok', async () => {
    mockFetch().mockResolvedValue({ ok: false, json: async () => null })
    expect(await translate('hola', 'en')).toBeNull()
  })

  it('detectLanguage returns the detected language code', async () => {
    mockFetch().mockResolvedValue({
      ok: true,
      json: async () => [[['h', 'o']], null, 'fr'],
    })
    expect(await detectLanguage('bonjour')).toBe('fr')
  })

  it('detectLanguage returns null on a non-ok response', async () => {
    mockFetch().mockResolvedValue({ ok: false, json: async () => null })
    expect(await detectLanguage('bonjour')).toBeNull()
  })

  it('detectLanguage returns null when fetch rejects', async () => {
    mockFetch().mockRejectedValue(new Error('network'))
    expect(await detectLanguage('bonjour')).toBeNull()
  })
})
