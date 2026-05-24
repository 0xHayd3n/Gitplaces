// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FolderKebabMenu, { FOLDER_PALETTE } from './FolderKebabMenu'

beforeEach(() => {
  ;(window as any).api = {
    agents: {
      updateFolder: vi.fn().mockResolvedValue({}),
    },
  }
})

function mountMenu(overrides: Partial<React.ComponentProps<typeof FolderKebabMenu>> = {}) {
  const onClose     = vi.fn()
  const onRename    = vi.fn()
  const onDelete    = vi.fn()
  const onNewFolder = vi.fn()
  const utils = render(
    <FolderKebabMenu
      x={10} y={10}
      folderId="f1"
      currentColor={null}
      currentEmoji={null}
      onClose={onClose}
      onRename={onRename}
      onDelete={onDelete}
      onNewFolder={onNewFolder}
      {...overrides}
    />,
  )
  return { ...utils, onClose, onRename, onDelete, onNewFolder }
}

describe('FolderKebabMenu', () => {
  it('renders Rename / Color / Emoji / New folder / Delete for a named folder', () => {
    mountMenu()
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /color/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /emoji/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /new folder/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeTruthy()
  })

  it('for Unfiled (folderId=null) shows only "New folder…"', () => {
    mountMenu({ folderId: null })
    expect(screen.queryByRole('menuitem', { name: /rename/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /color/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /emoji/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull()
    expect(screen.getByRole('menuitem', { name: /new folder/i })).toBeTruthy()
  })

  it('clicking "New folder…" calls onNewFolder and closes', () => {
    const { onNewFolder, onClose } = mountMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /new folder/i }))
    expect(onNewFolder).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking Rename calls onRename with folderId and closes', () => {
    const { onRename, onClose } = mountMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    expect(onRename).toHaveBeenCalledWith('f1')
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking Color expands an inline swatch row', () => {
    mountMenu()
    expect(screen.queryByTestId('folder-color-swatches')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /color/i }))
    expect(screen.getByTestId('folder-color-swatches')).toBeTruthy()
  })

  it('clicking a color swatch calls updateFolder with the right hex and closes', async () => {
    const { onClose } = mountMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /color/i }))
    const greenSwatch = screen.getByLabelText(/green/i)
    fireEvent.click(greenSwatch)
    await waitFor(() => {
      expect((window as any).api.agents.updateFolder)
        .toHaveBeenCalledWith('f1', { colorStart: FOLDER_PALETTE.find(c => c.name === 'Green')!.hex })
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking "None" clears the color', async () => {
    const { onClose } = mountMenu({ currentColor: '#22c55e' })
    fireEvent.click(screen.getByRole('menuitem', { name: /color/i }))
    fireEvent.click(screen.getByLabelText(/none/i))
    await waitFor(() => {
      expect((window as any).api.agents.updateFolder)
        .toHaveBeenCalledWith('f1', { colorStart: null })
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking Delete calls onDelete and closes', () => {
    const { onDelete, onClose } = mountMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith('f1')
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape closes the menu', () => {
    const { onClose } = mountMenu()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
