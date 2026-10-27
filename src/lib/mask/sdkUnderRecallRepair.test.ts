import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from './createMask'
import {
  detectSdkUnderRecall,
  hasThinKeepCorridor,
  repairSdkUnderRecall,
} from './sdkUnderRecallRepair'

function makeImage(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y)
      const o = (y * width + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = 255
    }
  }
  return new ImageData(data, width, height)
}

/** Pale carpet floor + white shirt rectangle + dark measuring tape strip. */
function carpetShirtTapeScene(w = 120, h = 160) {
  const shirt = { x0: 25, y0: 30, x1: 95, y1: 140 }
  const tapeY0 = 80
  const tapeY1 = 88
  const image = makeImage(w, h, (x, y) => {
    const onShirt =
      x >= shirt.x0 && x <= shirt.x1 && y >= shirt.y0 && y <= shirt.y1
    const onTape = onShirt && y >= tapeY0 && y <= tapeY1
    if (onTape) return [40, 40, 40]
    if (onShirt) return [235, 235, 232]
    // Beige carpet
    return [180, 165, 145]
  })
  return { image, shirt, tapeY0, tapeY1, w, h }
}

describe('sdkUnderRecallRepair', () => {
  it('detects tape-only KEEP as under-recall on pale carpet scenes', () => {
    const { image, w, h, tapeY0, tapeY1, shirt } = carpetShirtTapeScene()
    const mask = createMaskBuffer(w, h, 0)
    // Model kept only the dark tape.
    for (let y = tapeY0; y <= tapeY1; y += 1) {
      for (let x = shirt.x0; x <= shirt.x1; x += 1) {
        mask.data[y * w + x] = 255
      }
    }
    const d = detectSdkUnderRecall(mask, image)
    expect(d.underRecall).toBe(true)
  })

  it('reclaims white shirt body from tape-only mask', () => {
    const { image, w, h, tapeY0, tapeY1, shirt } = carpetShirtTapeScene()
    const mask = createMaskBuffer(w, h, 0)
    for (let y = tapeY0; y <= tapeY1; y += 1) {
      for (let x = shirt.x0; x <= shirt.x1; x += 1) {
        mask.data[y * w + x] = 255
      }
    }
    const before = mask.data.filter((v) => v >= 128).length
    const result = repairSdkUnderRecall(mask, image)
    expect(result.applied).toBe(true)
    expect(result.keepAfter).toBeGreaterThan(before * 3)

    // Most of the shirt body should be KEEP; carpet corners still REMOVE.
    let shirtKeep = 0
    let shirtTotal = 0
    for (let y = shirt.y0; y <= shirt.y1; y += 1) {
      for (let x = shirt.x0; x <= shirt.x1; x += 1) {
        shirtTotal += 1
        if (mask.data[y * w + x]! >= 128) shirtKeep += 1
      }
    }
    expect(shirtKeep / shirtTotal).toBeGreaterThan(0.55)
    expect(mask.data[2]! < 128).toBe(true)
    expect(mask.data[w * h - 3]! < 128).toBe(true)
  })

  it('bridges a REMOVE slice through the shirt along the tape', () => {
    const { image, w, h, shirt, tapeY0, tapeY1 } = carpetShirtTapeScene()
    const mask = createMaskBuffer(w, h, 0)
    // Shirt KEEP above and below tape, gap on tape rows (classic slice bug).
    for (let y = shirt.y0; y <= shirt.y1; y += 1) {
      if (y >= tapeY0 && y <= tapeY1) continue
      for (let x = shirt.x0; x <= shirt.x1; x += 1) {
        mask.data[y * w + x] = 255
      }
    }
    // Keep tape itself so gap is a thin corridor of REMOVE between KEEP bands.
    for (let y = tapeY0; y <= tapeY1; y += 1) {
      for (let x = shirt.x0; x <= shirt.x1; x += 1) {
        mask.data[y * w + x] = 0
      }
    }

    const keepRatio =
      mask.data.filter((v) => v >= 128).length / mask.data.length
    const detection = detectSdkUnderRecall(mask, image)
    expect({
      corridor: hasThinKeepCorridor(mask),
      detection,
      keepRatio,
    }).toMatchObject({ corridor: true, detection: { underRecall: true } })

    const result = repairSdkUnderRecall(mask, image)
    expect(result.applied).toBe(true)

    let gapKeep = 0
    let gapTotal = 0
    for (let y = tapeY0; y <= tapeY1; y += 1) {
      for (let x = shirt.x0 + 5; x <= shirt.x1 - 5; x += 1) {
        gapTotal += 1
        if (mask.data[y * w + x]! >= 128) gapKeep += 1
      }
    }
    expect(gapKeep / gapTotal).toBeGreaterThan(0.5)
  })

  it('does not flood healthy full-shirt masks into carpet', () => {
    const { image, w, h, shirt } = carpetShirtTapeScene()
    const mask = createMaskBuffer(w, h, 0)
    for (let y = shirt.y0; y <= shirt.y1; y += 1) {
      for (let x = shirt.x0; x <= shirt.x1; x += 1) {
        mask.data[y * w + x] = 255
      }
    }
    const before = mask.data.filter((v) => v >= 128).length
    const result = repairSdkUnderRecall(mask, image)
    expect(result.applied).toBe(false)
    expect(mask.data.filter((v) => v >= 128).length).toBe(before)
  })

  it('promotes soft alpha silhouette into hard KEEP', () => {
    const { image, w, h, shirt } = carpetShirtTapeScene()
    const mask = createMaskBuffer(w, h, 0)
    // Seed a small hard KEEP + soft body.
    for (let y = shirt.y0; y <= shirt.y0 + 8; y += 1) {
      for (let x = shirt.x0; x <= shirt.x0 + 8; x += 1) {
        mask.data[y * w + x] = 255
      }
    }
    for (let y = shirt.y0; y <= shirt.y1; y += 1) {
      for (let x = shirt.x0; x <= shirt.x1; x += 1) {
        const i = y * w + x
        if (mask.data[i]! < 128) mask.data[i] = 90
      }
    }
    const result = repairSdkUnderRecall(mask, image)
    expect(result.applied).toBe(true)
    expect(result.promotedSoft).toBeGreaterThan(100)
  })
})
