import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadedImage } from '../types'
import { createDefaultBackground } from '../types/background'
import { createMaskBuffer } from '../lib/mask/createMask'
import { clearAllMasks, setMask } from '../lib/mask/maskStore'
import { CanvasPreview } from './CanvasPreview'

describe('CanvasPreview', () => {
  const drawImage = vi.fn()

  beforeEach(() => {
    cleanup()
    clearAllMasks()
    drawImage.mockClear()

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage,
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      filter: 'none',
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext

    Object.defineProperty(globalThis.Image.prototype, 'src', {
      configurable: true,
      set(this: HTMLImageElement, value: string) {
        this.setAttribute('src', value)
        Object.defineProperty(this, 'naturalWidth', {
          configurable: true,
          value: 80,
        })
        Object.defineProperty(this, 'naturalHeight', {
          configurable: true,
          value: 60,
        })
        Promise.resolve().then(() => {
          this.onload?.(new Event('load'))
        })
      },
      get(this: HTMLImageElement) {
        return this.getAttribute('src') ?? ''
      },
    })
  })

  afterEach(() => {
    cleanup()
    clearAllMasks()
  })

  it('renders empty state when no image is selected', () => {
    render(<CanvasPreview image={null} />)
    expect(screen.getByTestId('canvas-preview-empty')).toBeInTheDocument()
  })

  it('draws the selected image onto the canvas', async () => {
    const image: UploadedImage = {
      id: '1',
      file: new File([], 'coat.png', { type: 'image/png' }),
      name: 'coat.png',
      objectUrl: 'blob:mock-coat',
      width: 80,
      height: 60,
    }

    render(<CanvasPreview image={image} />)

    expect(screen.getByTestId('preview-canvas')).toBeInTheDocument()
    await waitFor(() => {
      expect(drawImage).toHaveBeenCalled()
    })
  })

  it('falls back to the original when KEEP mask is empty (no blank checkerboard)', async () => {
    const image: UploadedImage = {
      id: 'empty-mask',
      file: new File([], 'hoodie.jpg', { type: 'image/jpeg' }),
      name: 'hoodie.jpg',
      objectUrl: 'blob:mock-hoodie',
      width: 80,
      height: 60,
    }
    setMask(image.id, createMaskBuffer(80, 60, 0))

    render(
      <CanvasPreview
        image={image}
        background={createDefaultBackground()}
        showResult
        maskRevision={1}
      />,
    )

    await waitFor(() => {
      expect(drawImage).toHaveBeenCalled()
    })
    // Meta must not claim "result" when we fell back to the original photo.
    expect(screen.getByTestId('canvas-preview')).not.toHaveTextContent(/· result/)
  })

  it('keeps drawing when a usable KEEP mask is present with showResult', async () => {
    const image: UploadedImage = {
      id: 'good-mask',
      file: new File([], 'hoodie.jpg', { type: 'image/jpeg' }),
      name: 'hoodie.jpg',
      objectUrl: 'blob:mock-hoodie-2',
      width: 40,
      height: 30,
    }
    const mask = createMaskBuffer(40, 30, 0)
    mask.data.fill(255)
    setMask(image.id, mask)

    render(
      <CanvasPreview
        image={image}
        background={{
          type: 'color',
          color: '#ffffff',
          imageUrl: null,
          imageName: null,
          fitMode: 'cover',
        }}
        showResult
        maskRevision={2}
      />,
    )

    await waitFor(() => {
      expect(drawImage).toHaveBeenCalled()
    })
    expect(screen.getByTestId('preview-canvas')).toBeInTheDocument()
  })
})
