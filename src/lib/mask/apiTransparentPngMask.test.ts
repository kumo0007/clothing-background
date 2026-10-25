import { describe, expect, it } from 'vitest'
import {
  countSoftAlphaPixels,
  extractAlphaMaskFromRgba,
  maskFromTransparentRgba,
  resizeMaskNearest,
} from './apiTransparentPngMask'
import { createMaskBuffer } from './createMask'
import { compositePixelBuffers } from '../rendering/compositePixels'

function rgbaFromAlpha(
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number,
  rgb: [number, number, number] = [10, 20, 30],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      out[i] = rgb[0]
      out[i + 1] = rgb[1]
      out[i + 2] = rgb[2]
      out[i + 3] = alphaAt(x, y)
    }
  }
  return out
}

describe('apiTransparentPngMask', () => {
  it('extracts KEEP polarity from alpha (255 keep / 0 bg)', () => {
    const rgba = rgbaFromAlpha(2, 1, (x) => (x === 0 ? 255 : 0))
    const mask = extractAlphaMaskFromRgba(rgba, 2, 1)
    expect(Array.from(mask.data)).toEqual([255, 0])
  })

  it('preserves partial / soft alpha without thresholding', () => {
    const rgba = rgbaFromAlpha(3, 1, (x) => [0, 128, 255][x]!)
    const mask = extractAlphaMaskFromRgba(rgba, 3, 1)
    expect(Array.from(mask.data)).toEqual([0, 128, 255])
    expect(countSoftAlphaPixels(mask)).toBe(1)
  })

  it('does not invert alpha polarity (high alpha stays KEEP)', () => {
    const rgba = rgbaFromAlpha(4, 1, (x) => [255, 200, 40, 0][x]!)
    const mask = extractAlphaMaskFromRgba(rgba, 4, 1)
    expect(mask.data[0]).toBe(255)
    expect(mask.data[1]).toBe(200)
    expect(mask.data[2]).toBe(40)
    expect(mask.data[3]).toBe(0)
    // Soft values are not snapped to 0/255
    expect(mask.data[1]).not.toBe(255)
    expect(mask.data[2]).not.toBe(0)
  })

  it('same-size conversion reports resized=false and matches source dims', () => {
    const rgba = rgbaFromAlpha(5, 3, (x, y) => ((x + y) % 2 === 0 ? 255 : 0))
    const { mask, resized } = maskFromTransparentRgba(rgba, 5, 3, 5, 3)
    expect(resized).toBe(false)
    expect(mask.width).toBe(5)
    expect(mask.height).toBe(3)
    expect(mask.data[0]).toBe(255)
    expect(mask.data[1]).toBe(0)
  })

  it('does not mutate the source RGBA buffer', () => {
    const rgba = rgbaFromAlpha(2, 2, () => 200, [7, 8, 9])
    const before = Array.from(rgba)
    extractAlphaMaskFromRgba(rgba, 2, 2)
    expect(Array.from(rgba)).toEqual(before)
  })

  it('resizes provider output to source dimensions deliberately', () => {
    const rgba = rgbaFromAlpha(2, 2, (x, y) => (x === 0 && y === 0 ? 255 : 0))
    const { mask, resized } = maskFromTransparentRgba(rgba, 2, 2, 4, 4)
    expect(resized).toBe(true)
    expect(mask.width).toBe(4)
    expect(mask.height).toBe(4)
    expect(mask.data[0]).toBe(255)
  })

  it('maps mobile-downscaled alpha back to phone-photo export dimensions', () => {
    // Simulate inference at 1600 long-edge from a 4032×3024 capture.
    const srcW = 4032
    const srcH = 3024
    const inferW = 1600
    const inferH = 1200
    const rgba = rgbaFromAlpha(inferW, inferH, (x, y) => {
      // KEEP a centered rectangle in inference space
      const left = Math.floor(inferW * 0.25)
      const right = Math.floor(inferW * 0.75)
      const top = Math.floor(inferH * 0.2)
      const bottom = Math.floor(inferH * 0.8)
      return x >= left && x < right && y >= top && y < bottom ? 255 : 0
    })
    const { mask, resized } = maskFromTransparentRgba(
      rgba,
      inferW,
      inferH,
      srcW,
      srcH,
    )
    expect(resized).toBe(true)
    expect(mask.width).toBe(srcW)
    expect(mask.height).toBe(srcH)
    // Center of garment region must remain KEEP after upsample.
    expect(mask.data[Math.floor(srcH / 2) * srcW + Math.floor(srcW / 2)]).toBe(
      255,
    )
    // Far corner must remain BG (alignment not shifted into borders).
    expect(mask.data[0]).toBe(0)
    expect(mask.data[srcW * srcH - 1]).toBe(0)
  })

  it('preserves portrait orientation when remapping downscaled alpha', () => {
    const srcW = 1080
    const srcH = 1920
    const inferW = 900
    const inferH = 1600
    const rgba = rgbaFromAlpha(inferW, inferH, (x, y) =>
      y > inferH * 0.1 && y < inferH * 0.9 && x > inferW * 0.3 && x < inferW * 0.7
        ? 255
        : 0,
    )
    const { mask } = maskFromTransparentRgba(rgba, inferW, inferH, srcW, srcH)
    expect(mask.width).toBe(1080)
    expect(mask.height).toBe(1920)
    expect(mask.data[Math.floor(srcH / 2) * srcW + Math.floor(srcW / 2)]).toBe(
      255,
    )
  })

  it('nearest resize preserves binary corners', () => {
    const source = createMaskBuffer(2, 2, 0)
    source.data[0] = 255
    source.data[3] = 200
    const out = resizeMaskNearest(source, 4, 4)
    expect(out.data[0]).toBe(255)
    expect(out.data[4 * 4 - 1]).toBe(200)
  })

  it('composites original RGB × API alpha onto a replacement background', () => {
    const w = 2
    const h = 1
    const original = new Uint8ClampedArray([
      100, 0, 0, 255, // garment red
      0, 100, 0, 255, // garment green (will be fully masked out)
    ])
    const rgba = rgbaFromAlpha(w, h, (x) => (x === 0 ? 255 : 0))
    const { mask } = maskFromTransparentRgba(rgba, w, h, w, h)
    const bg = new Uint8ClampedArray([0, 0, 200, 255, 0, 0, 200, 255])
    const out = compositePixelBuffers(original, mask.data, bg)
    // KEEP pixel: original red
    expect(out[0]).toBe(100)
    expect(out[1]).toBe(0)
    expect(out[2]).toBe(0)
    // REMOVE pixel: solid blue bg
    expect(out[4]).toBe(0)
    expect(out[5]).toBe(0)
    expect(out[6]).toBe(200)
    // Soft alpha mid-blend
    const softMask = createMaskBuffer(1, 1, 128)
    const softOrig = new Uint8ClampedArray([255, 0, 0, 255])
    const softBg = new Uint8ClampedArray([0, 0, 255, 255])
    const softOut = compositePixelBuffers(softOrig, softMask.data, softBg)
    // 255*(128/255) → 128 red; 255*(127/255) → 127 blue (integer round)
    expect(softOut[0]).toBe(128)
    expect(softOut[2]).toBe(127)
  })
})
