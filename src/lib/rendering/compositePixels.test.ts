import { describe, expect, it } from 'vitest'
import { compositePixelBuffers } from './compositePixels'

describe('compositePixelBuffers', () => {
  it('keeps original pixels where the mask is white and background where black', () => {
    const original = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255])
    const mask = new Uint8ClampedArray([255, 0])
    const background = new Uint8ClampedArray([0, 255, 0, 255, 0, 255, 0, 255])

    const result = compositePixelBuffers(original, mask, background)

    expect(Array.from(result.slice(0, 4))).toEqual([255, 0, 0, 255])
    expect(Array.from(result.slice(4, 8))).toEqual([0, 255, 0, 255])
  })

  it('blends gray mask edges without inventing garment detail', () => {
    const original = new Uint8ClampedArray([100, 0, 0, 255])
    const mask = new Uint8ClampedArray([128])
    const background = new Uint8ClampedArray([0, 0, 0, 255])
    const result = compositePixelBuffers(original, mask, background)
    expect(result[0]).toBe(50)
  })

  it('transparent mode sets output alpha = sourceA × maskA', () => {
    const original = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255])
    const mask = new Uint8ClampedArray([255, 0])
    const background = new Uint8ClampedArray([9, 9, 9, 255, 9, 9, 9, 255])
    const result = compositePixelBuffers(original, mask, background, {
      transparentBackground: true,
    })
    expect(result[3]).toBe(255)
    expect(result[7]).toBe(0)
    expect(Array.from(result.slice(0, 3))).toEqual([10, 20, 30])
  })
})
