import { describe, expect, it, vi } from 'vitest'
import { drawBackgroundImage } from './renderBackground'

describe('drawBackgroundImage', () => {
  it('fills letterbox bands before contain draw', () => {
    const fillRect = vi.fn()
    const drawImage = vi.fn()
    const ctx = {
      fillStyle: '',
      fillRect,
      drawImage,
    } as unknown as CanvasRenderingContext2D

    // 100x50 image into 100x100 target → vertical letterbox with contain
    drawBackgroundImage(ctx, {} as CanvasImageSource, 100, 50, 100, 100, 'contain', '#00aa55')

    expect(ctx.fillStyle).toBe('#00aa55')
    expect(fillRect).toHaveBeenCalledWith(0, 0, 100, 100)
    expect(drawImage).toHaveBeenCalled()
  })
})
