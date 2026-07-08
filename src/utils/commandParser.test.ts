import { describe, it, expect } from 'vitest'
import { extractCommands } from './commandParser'

describe('extractCommands', () => {
  it('extracts a shell block with its preceding heading as the label', () => {
    const md = [
      '## Installation',
      '```bash',
      'npm install',
      '```',
    ].join('\n')
    expect(extractCommands(md)).toEqual([
      { label: 'Installation', lang: 'bash', code: 'npm install' },
    ])
  })

  it('recognises a range of shell language tags', () => {
    for (const lang of ['sh', 'shell', 'zsh', 'powershell', 'console']) {
      const md = `run it\n\`\`\`${lang}\nls\n\`\`\``
      const blocks = extractCommands(md)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].lang).toBe(lang)
    }
  })

  it('ignores non-shell code blocks', () => {
    const md = [
      '```js',
      'console.log("hi")',
      '```',
      '```python',
      'print("hi")',
      '```',
    ].join('\n')
    expect(extractCommands(md)).toEqual([])
  })

  it('strips heading, bold and italic markers from the label', () => {
    const md = '### **Build** the _project_\n```bash\nmake\n```'
    expect(extractCommands(md)[0].label).toBe('Build the project')
  })

  it('skips a shell block whose body is empty', () => {
    const md = 'label\n```bash\n\n```'
    expect(extractCommands(md)).toEqual([])
  })

  it('handles tilde fences and multiple blocks', () => {
    const md = [
      'First',
      '~~~sh',
      'echo one',
      '~~~',
      'Second',
      '```bash',
      'echo two',
      '```',
    ].join('\n')
    expect(extractCommands(md)).toEqual([
      { label: 'First', lang: 'sh', code: 'echo one' },
      { label: 'Second', lang: 'bash', code: 'echo two' },
    ])
  })

  it('uses an empty label when no preceding text exists', () => {
    const md = '```bash\nwhoami\n```'
    expect(extractCommands(md)[0].label).toBe('')
  })
})
