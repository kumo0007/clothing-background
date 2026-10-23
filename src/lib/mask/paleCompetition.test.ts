import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from './createMask'
import {
  applyPaleCompetition,
  markCompetitionProtectedPale,
} from './paleCompetition'

function makeImage(
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

describe('paleCompetition', () => {
  it('reclaims pale leather panel closer to dark sole than to border card', () => {
    const w = 48
    const h = 48
    const image = makeImage(w, h, [226, 226, 226])
    // Dark sole at bottom-center
    for (let y = 34; y < 40; y += 1) {
      for (let x = 14; x < 34; x += 1) setRgb(image, x, y, [30, 30, 30])
    }
    // Flat pale leather above sole (same luma band as card but interior)
    for (let y = 16; y < 34; y += 1) {
      for (let x = 14; x < 34; x += 1) setRgb(image, x, y, [230, 230, 230])
    }

    const mask = createMaskBuffer(w, h, 0)
    // Sole + a seed strip of pale KEEP touching dark (gate requires pale KEEP)
    for (let y = 34; y < 40; y += 1) {
      for (let x = 14; x < 34; x += 1) mask.data[y * w + x] = 255
    }
    for (let y = 28; y < 34; y += 1) {
      for (let x = 14; x < 34; x += 1) mask.data[y * w + x] = 255
    }
    // Border is REMOVE (exterior seeds)
    const result = applyPaleCompetition(mask, image)
    expect(result.assignedKeep).toBeGreaterThan(80)
    // Interior leather panel kept
    expect(mask.data[24 * w + 24]!).toBe(255)
    // Near-corner card stays REMOVE
    expect(mask.data[2 * w + 2]!).toBe(0)
  })

  it('protects competition-assigned pale from being unmarked as unprotected', () => {
    const w = 40
    const h = 40
    const image = makeImage(w, h, [228, 228, 228])
    for (let y = 28; y < 34; y += 1) {
      for (let x = 12; x < 28; x += 1) setRgb(image, x, y, [25, 25, 25])
    }
    for (let y = 12; y < 28; y += 1) {
      for (let x = 12; x < 28; x += 1) setRgb(image, x, y, [232, 232, 232])
    }
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 12; y < 34; y += 1) {
      for (let x = 12; x < 28; x += 1) mask.data[y * w + x] = 255
    }
    applyPaleCompetition(mask, image)
    const protectedPale = markCompetitionProtectedPale(mask, image)
    let protectedCount = 0
    for (let i = 0; i < protectedPale.length; i += 1) {
      if (protectedPale[i]) protectedCount += 1
    }
    expect(protectedCount).toBeGreaterThan(40)
  })

  it('does not carve dark structure when exterior wins nearby pale', () => {
    const w = 32
    const h = 32
    const image = makeImage(w, h, [230, 230, 230])
    for (let y = 10; y < 22; y += 1) {
      for (let x = 10; x < 22; x += 1) setRgb(image, x, y, [20, 20, 20])
    }
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 10; y < 22; y += 1) {
      for (let x = 10; x < 22; x += 1) mask.data[y * w + x] = 255
    }
    applyPaleCompetition(mask, image)
    expect(mask.data[16 * w + 16]!).toBe(255)
  })
})
