import { describe, expect, it, vi } from 'vitest'
import {
  drawBackgroundImage,
  measureUniformBorderInset,
} from './renderBackground'

describe('measureUniformBorderInset', () => {
  it('trims near-white footer bars like beach environment JPEGs', () => {
    const w = 40
    const h = 30
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4
        if (y >= h - 5) {
          data[o] = 254
          data[o + 1] = 254
          data[o + 2] = 253
        } else {
          data[o] = 80
          data[o + 1] = 160
          data[o + 2] = 210
        }
        data[o + 3] = 255
      }
    }
    const inset = measureUniformBorderInset(data, w, h)
    expect(inset.bottom).toBeGreaterThanOrEqual(4)
    expect(inset.top).toBe(0)
    expect(inset.left).toBe(0)
    expect(inset.right).toBe(0)
  })

  it('leaves images without a uniform border unchanged', () => {
    const w = 24
    const h = 24
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4
        data[o] = 40 + ((x * 7) % 80)
        data[o + 1] = 120 + ((y * 5) % 60)
        data[o + 2] = 180
        data[o + 3] = 255
      }
    }
    expect(measureUniformBorderInset(data, w, h)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    })
  })

  it('does not wipe content when most of the frame is near-white', () => {
    const w = 20
    const h = 20
    const data = new Uint8ClampedArray(w * h * 4)
    data.fill(255)
    // Tiny dark island in the center — maxFrac must leave a usable window.
    for (let y = 8; y < 12; y += 1) {
      for (let x = 8; x < 12; x += 1) {
        const o = (y * w + x) * 4
        data[o] = 20
        data[o + 1] = 20
        data[o + 2] = 20
      }
    }
    const inset = measureUniformBorderInset(data, w, h)
    expect(w - inset.left - inset.right).toBeGreaterThanOrEqual(4)
    expect(h - inset.top - inset.bottom).toBeGreaterThanOrEqual(4)
  })
})

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
    // Pass null inset so jsdom does not attempt getImageData auto-measure.
    drawBackgroundImage(
      ctx,
      {} as CanvasImageSource,
      100,
      50,
      100,
      100,
      'contain',
      '#00aa55',
      null,
    )

    expect(ctx.fillStyle).toBe('#00aa55')
    expect(fillRect).toHaveBeenCalledWith(0, 0, 100, 100)
    expect(drawImage).toHaveBeenCalled()
  })

  it('cover samples trimmed content rect when inset is provided', () => {
    const drawImage = vi.fn()
    const ctx = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D

    drawBackgroundImage(
      ctx,
      {} as CanvasImageSource,
      100,
      50,
      100,
      100,
      'cover',
      '#F5F5F5',
      { top: 0, right: 0, bottom: 8, left: 0 },
    )

    expect(drawImage).toHaveBeenCalled()
    const args = drawImage.mock.calls[0]!
    // source crop: sx,sy,sw,sh = 0,0,100,42
    expect(args[1]).toBe(0)
    expect(args[2]).toBe(0)
    expect(args[3]).toBe(100)
    expect(args[4]).toBe(42)
  })
})
