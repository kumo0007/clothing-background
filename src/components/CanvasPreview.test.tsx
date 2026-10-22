import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadedImage } from '../types'
import { CanvasPreview } from './CanvasPreview'

describe('CanvasPreview', () => {
  beforeEach(() => {
    cleanup()

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
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
      expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled()
    })
  })
})
