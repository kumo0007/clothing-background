import { describe, expect, it } from 'vitest'
import { createDefaultAdjustments, normalizeCrop } from '../../types/adjustments'
import { createMaskBuffer } from '../mask/createMask'
import {
  applyOutputSize,
  applyProductShadow,
  rotatedSize,
  skewedSize,
} from './renderFinal'

function solidCanvas(
  width: number,
  height: number,
  color: string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = color
    ctx.fillRect(0, 0, width, height)
  }
  return canvas
}

describe('renderFinal helpers', () => {
  it('swaps dimensions for 90 and 270 degree rotation', () => {
    expect(rotatedSize(100, 50, 0)).toEqual({ width: 100, height: 50 })
    expect(rotatedSize(100, 50, 90)).toEqual({ width: 50, height: 100 })
    expect(rotatedSize(100, 50, 180)).toEqual({ width: 100, height: 50 })
    expect(rotatedSize(100, 50, 270)).toEqual({ width: 50, height: 100 })
  })

  it('expands bounds for a slight non-cardinal tilt', () => {
    const tilted = rotatedSize(100, 50, 8)
    expect(tilted.width).toBeGreaterThan(100)
    expect(tilted.height).toBeGreaterThan(50)
  })

  it('normalizes crop rectangles into bounds', () => {
    expect(normalizeCrop({ x: -0.2, y: 0.1, width: 2, height: 0.01 })).toEqual({
      x: 0,
      y: 0.1,
      width: 1,
      height: 0.05,
    })
  })

  it('expands canvas bounds for non-zero skew', () => {
    const identity = skewedSize(100, 80, 0, 0)
    expect(identity).toEqual({ width: 100, height: 80, offsetX: 0, offsetY: 0 })

    const skewed = skewedSize(100, 80, 20, 0)
    expect(skewed.width).toBeGreaterThan(100)
    expect(skewed.height).toBe(80)
    expect(skewed.offsetX).toBeGreaterThanOrEqual(0)
  })

  it('leaves size unchanged when output dimensions are null', () => {
    const source = solidCanvas(120, 80, '#112233')
    const result = applyOutputSize(source, null, null, 'contain', '#ffffff')
    expect(result).toBe(source)
  })

  it('resizes into a square contain canvas', () => {
    const source = solidCanvas(100, 50, '#ff0000')
    const result = applyOutputSize(source, 200, 200, 'contain', '#00ff00')
    expect(result.width).toBe(200)
    expect(result.height).toBe(200)
    expect(result).not.toBe(source)
  })

  it('cover produces the requested target dimensions', () => {
    const source = solidCanvas(100, 50, '#0000ff')
    const result = applyOutputSize(source, 80, 80, 'cover', '#111111')
    expect(result.width).toBe(80)
    expect(result.height).toBe(80)
  })

  it('clamps output dimensions into a safe range', () => {
    const source = solidCanvas(100, 100, '#ffffff')
    const tiny = applyOutputSize(source, 10, 10, 'stretch', '#000000')
    expect(tiny.width).toBe(64)
    expect(tiny.height).toBe(64)
    const huge = applyOutputSize(source, 99999, 99999, 'stretch', '#000000')
    expect(huge.width).toBe(4096)
    expect(huge.height).toBe(4096)
  })

  it('skips product shadow when opacity is 0 or mask is missing', () => {
    const source = solidCanvas(40, 40, '#ffffff')
    const mask = createMaskBuffer(40, 40, 0)
    for (let y = 10; y < 30; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        mask.data[y * 40 + x] = 255
      }
    }
    const off = createDefaultAdjustments()
    expect(applyProductShadow(source, mask, off)).toBe(source)
    expect(applyProductShadow(source, null, { ...off, shadowOpacity: 40 })).toBe(
      source,
    )
  })

  it('keeps product shadow canvas dimensions stable', () => {
    const source = solidCanvas(48, 48, '#eeeeee')
    const mask = createMaskBuffer(48, 48, 0)
    for (let y = 12; y < 36; y += 1) {
      for (let x = 12; x < 36; x += 1) {
        mask.data[y * 48 + x] = 255
      }
    }
    const adjustments = {
      ...createDefaultAdjustments(),
      shadowBlur: 4,
      shadowOffsetX: 0,
      shadowOffsetY: 6,
      shadowOpacity: 50,
      shadowColor: '#000000',
    }
    const result = applyProductShadow(source, mask, adjustments)
    // jsdom has no pixel canvas — assert size only (browser verifies pixels).
    expect(result.width).toBe(48)
    expect(result.height).toBe(48)
  })
})
