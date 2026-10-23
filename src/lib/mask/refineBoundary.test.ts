import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from './createMask'
import { refineSilhouetteBoundary } from './refineBoundary'
import { stripForeignBorderBands } from './selectSimilar'

function makeImageData(
  width: number,
  height: number,
  fill: [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4
    data[o] = fill[0]
    data[o + 1] = fill[1]
    data[o + 2] = fill[2]
    data[o + 3] = 255
  }
  return new ImageData(data as unknown as ImageDataArray, width, height)
}

function setRgb(
  image: ImageData,
  x: number,
  y: number,
  rgb: [number, number, number],
): void {
  const o = (y * image.width + x) * 4
  image.data[o] = rgb[0]
  image.data[o + 1] = rgb[1]
  image.data[o + 2] = rgb[2]
}

function snapshotRgb(image: ImageData): Uint8ClampedArray {
  return new Uint8ClampedArray(image.data)
}

describe('refineSilhouetteBoundary', () => {
  it('does not mutate source RGB', () => {
    const image = makeImageData(24, 24, [220, 220, 220])
    for (let y = 8; y < 16; y += 1) {
      for (let x = 8; x < 16; x += 1) setRgb(image, x, y, [30, 30, 30])
    }
    for (let y = 7; y < 17; y += 1) {
      setRgb(image, 7, y, [236, 236, 236])
      setRgb(image, 16, y, [236, 236, 236])
    }
    const before = snapshotRgb(image)
    const mask = createMaskBuffer(24, 24, 255)
    for (let y = 0; y < 24; y += 1) {
      for (let x = 0; x < 24; x += 1) {
        if (x < 6 || x >= 18 || y < 6 || y >= 18) mask.data[y * 24 + x] = 0
      }
    }
    for (let y = 7; y < 17; y += 1) {
      mask.data[y * 24 + 7] = 255
      mask.data[y * 24 + 16] = 255
    }
    refineSilhouetteBoundary(mask, image, 40)
    expect(Array.from(image.data)).toEqual(Array.from(before))
  })

  it('peels bright AA ring next to dark garment without eating body', () => {
    const w = 28
    const h = 28
    const image = makeImageData(w, h, [224, 224, 224])
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 8; y < 20; y += 1) {
      for (let x = 8; x < 20; x += 1) {
        setRgb(image, x, y, [25, 25, 25])
        mask.data[y * w + x] = 255
      }
    }
    // 1px near-white AA around body still KEEP, outside REMOVE
    for (let y = 7; y < 21; y += 1) {
      for (const x of [7, 20]) {
        setRgb(image, x, y, [238, 238, 238])
        mask.data[y * w + x] = 255
      }
    }
    for (let x = 7; x < 21; x += 1) {
      for (const y of [7, 20]) {
        setRgb(image, x, y, [238, 238, 238])
        mask.data[y * w + x] = 255
      }
    }
    // Outer REMOVE
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (x < 6 || x > 21 || y < 6 || y > 21) mask.data[y * w + x] = 0
      }
    }

    refineSilhouetteBoundary(mask, image, 40)
    expect(mask.data[7 * w + 7]).toBe(0)
    expect(mask.data[14 * w + 14]).toBe(255)
  })

  it('preserves warm coat/dress edge pixels', () => {
    const w = 24
    const h = 24
    const image = makeImageData(w, h, [222, 222, 222])
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 6; y < 18; y += 1) {
      for (let x = 6; x < 18; x += 1) {
        setRgb(image, x, y, [180, 120, 90])
        mask.data[y * w + x] = 255
      }
    }
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (x < 5 || x > 18 || y < 5 || y > 18) mask.data[y * w + x] = 0
      }
    }
    refineSilhouetteBoundary(mask, image, 40)
    expect(mask.data[12 * w + 6]).toBeGreaterThanOrEqual(200)
    expect(mask.data[12 * w + 12]).toBe(255)
  })

  it('preserves thin dark strap pixels', () => {
    const w = 30
    const h = 24
    const image = makeImageData(w, h, [226, 226, 226])
    const mask = createMaskBuffer(w, h, 0)
    // Body
    for (let y = 12; y < 22; y += 1) {
      for (let x = 10; x < 20; x += 1) {
        setRgb(image, x, y, [40, 35, 30])
        mask.data[y * w + x] = 255
      }
    }
    // Thin vertical strap
    for (let y = 2; y < 12; y += 1) {
      setRgb(image, 14, y, [30, 30, 30])
      setRgb(image, 15, y, [30, 30, 30])
      mask.data[y * w + 14] = 255
      mask.data[y * w + 15] = 255
    }
    refineSilhouetteBoundary(mask, image, 40)
    expect(mask.data[6 * w + 14]).toBeGreaterThanOrEqual(200)
  })

  it('does not restore foreign footer after refine + stripForeign', () => {
    const w = 36
    const h = 36
    const image = makeImageData(w, h, [220, 220, 220])
    for (let y = 6; y < 24; y += 1) {
      for (let x = 8; x < 28; x += 1) setRgb(image, x, y, [30, 30, 30])
    }
    for (let y = 28; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) setRgb(image, x, y, [25, 120, 210])
    }
    const mask = createMaskBuffer(w, h, 255)
    stripForeignBorderBands(mask, image)
    expect(mask.data[32 * w + 4]).toBe(0)
    refineSilhouetteBoundary(mask, image, 40)
    stripForeignBorderBands(mask, image)
    expect(mask.data[32 * w + 4]).toBe(0)
    expect(mask.data[14 * w + 18]).toBe(255)
  })

  it('clears soft studio alpha on the silhouette that composites as a halo', () => {
    const w = 24
    const h = 24
    const image = makeImageData(w, h, [224, 224, 224])
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 8; y < 16; y += 1) {
      for (let x = 8; x < 16; x += 1) {
        setRgb(image, x, y, [20, 20, 20])
        mask.data[y * w + x] = 255
      }
    }
    // Soft studio ring
    for (let y = 7; y < 17; y += 1) {
      for (const x of [7, 16]) {
        setRgb(image, x, y, [230, 230, 230])
        mask.data[y * w + x] = 140
      }
    }
    refineSilhouetteBoundary(mask, image, 40)
    expect(mask.data[10 * w + 7]).toBe(0)
    expect(mask.data[12 * w + 12]).toBe(255)
  })
})
