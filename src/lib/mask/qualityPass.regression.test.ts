/**
 * Final quality-pass regression suite (difficult garments + pipeline contracts).
 * Synthetic fixtures only — does not claim visual fix of stale result PNGs.
 */
import { describe, expect, it } from 'vitest'
import { createDefaultAdjustments } from '../../types/adjustments'
import { createMaskBuffer } from './createMask'
import { MaskHistory } from './maskHistory'
import {
  deleteMask,
  getMask,
  getOrCreateMask,
  setMask,
  clearAllMasks,
} from './maskStore'
import { paintMaskCircle } from './paintMask'
import {
  featherMaskEdges,
  fillMaskHoles,
  morphCloseMask,
} from './refineMask'
import {
  averageCornerColor,
  floodSelectSimilar,
  reclaimGarmentFromKeep,
  removeSimilarToCorners,
  chokeBrightStudioBesideDark,
  stripBorderConnectedStudio,
  stripDarkWalledStudioPockets,
  stripDetachedStudioIslands,
  stripEnclosedFlatStudio,
  stripForeignBorderBands,
  stripOpenArchStudio,
} from './selectSimilar'
import { compositePixelBuffers } from '../rendering/compositePixels'
import {
  applyOutputSize,
  rotatedSize,
} from '../rendering/renderFinal'
import { screenToImage, imageToScreen } from '../rendering/coords'

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

describe('quality pass — mask polarity & source immutability', () => {
  it('documents polarity: 255 keep garment, 0 replace background', () => {
    const original = new Uint8ClampedArray([10, 20, 30, 255, 200, 200, 200, 255])
    const mask = new Uint8ClampedArray([255, 0])
    const background = new Uint8ClampedArray([1, 2, 3, 255, 9, 9, 9, 255])
    const out = compositePixelBuffers(original, mask, background)
    expect(Array.from(out.slice(0, 3))).toEqual([10, 20, 30])
    expect(Array.from(out.slice(4, 7))).toEqual([9, 9, 9])
  })

  it('never mutates source ImageData during corner remove', () => {
    const image = makeImageData(24, 24, [220, 220, 220])
    for (let y = 8; y < 16; y += 1) {
      for (let x = 8; x < 16; x += 1) {
        setRgb(image, x, y, [40, 40, 40])
      }
    }
    const before = snapshotRgb(image)
    const mask = createMaskBuffer(24, 24, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(Array.from(image.data)).toEqual(Array.from(before))
  })
})

describe('quality pass — difficult garments (synthetic)', () => {
  it('1. white sneakers on light card: pale body + dark sole accents kept', () => {
    const w = 40
    const h = 40
    const image = makeImageData(w, h, [216, 216, 216])
    // Flat white upper
    for (let y = 12; y < 28; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        setRgb(image, x, y, [246, 246, 248])
      }
    }
    // Dark sole / lace accents (reclaim seeds)
    for (let x = 12; x < 28; x += 1) {
      setRgb(image, x, 26, [30, 30, 30])
      setRgb(image, x, 27, [25, 25, 25])
    }
    setRgb(image, 18, 16, [20, 20, 20])
    setRgb(image, 19, 16, [20, 20, 20])

    const mask = createMaskBuffer(w, h, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[2 * w + 2]).toBe(0)
    expect(mask.data[26 * w + 18]).toBe(255)
    expect(mask.data[18 * w + 18]).toBe(255)
    expect(mask.data[16 * w + 18]).toBe(255)
  })

  it('2. black cap on light card: body kept, soft mid-gray contact shadow peeled', () => {
    const w = 36
    const h = 36
    const image = makeImageData(w, h, [230, 230, 230])
    for (let y = 10; y < 24; y += 1) {
      for (let x = 10; x < 26; x += 1) {
        setRgb(image, x, y, [25, 25, 25])
      }
    }
    // Soft contact shadow under brim (must not stay as hard KEEP slab)
    for (let y = 24; y < 28; y += 1) {
      for (let x = 12; x < 24; x += 1) {
        setRgb(image, x, y, [120, 120, 120])
      }
    }

    const mask = createMaskBuffer(w, h, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[16 * w + 16]).toBe(255)
    expect(mask.data[26 * w + 16]).toBe(0)
    expect(mask.data[2 * w + 2]).toBe(0)
  })

  it('3. satin-like mid-tone body with bright highlight fold kept', () => {
    const w = 32
    const h = 32
    const image = makeImageData(w, h, [225, 225, 225])
    for (let y = 8; y < 24; y += 1) {
      for (let x = 8; x < 24; x += 1) {
        setRgb(image, x, y, [180, 120, 140])
      }
    }
    // Highlight fold (brighter, still chromatic)
    for (let y = 12; y < 14; y += 1) {
      for (let x = 10; x < 22; x += 1) {
        setRgb(image, x, y, [220, 170, 185])
      }
    }

    const mask = createMaskBuffer(w, h, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[16 * w + 16]).toBe(255)
    expect(mask.data[12 * w + 14]).toBe(255)
    expect(mask.data[1 * w + 1]).toBe(0)
  })

  it('4. hoodie/sweater: dark body + cuff edge kept; corner studio removed', () => {
    const w = 36
    const h = 36
    const image = makeImageData(w, h, [222, 222, 222])
    for (let y = 8; y < 28; y += 1) {
      for (let x = 8; x < 28; x += 1) {
        setRgb(image, x, y, [45, 42, 40])
      }
    }
    // Slightly lighter cuff band
    for (let x = 10; x < 26; x += 1) {
      setRgb(image, x, 26, [70, 65, 60])
      setRgb(image, x, 27, [70, 65, 60])
    }

    const mask = createMaskBuffer(w, h, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[18 * w + 18]).toBe(255)
    expect(mask.data[26 * w + 18]).toBe(255)
    expect(mask.data[1]).toBe(0)
  })

  it('5. thin strap / handle structure survives corner remove', () => {
    const w = 40
    const h = 40
    const image = makeImageData(w, h, [228, 228, 228])
    // Main body
    for (let y = 16; y < 32; y += 1) {
      for (let x = 12; x < 28; x += 1) {
        setRgb(image, x, y, [160, 90, 110])
      }
    }
    // Thin vertical straps (2px)
    for (let y = 4; y < 17; y += 1) {
      setRgb(image, 14, y, [150, 85, 100])
      setRgb(image, 15, y, [150, 85, 100])
      setRgb(image, 24, y, [150, 85, 100])
      setRgb(image, 25, y, [150, 85, 100])
    }

    const mask = createMaskBuffer(w, h, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[10 * w + 14]).toBe(255)
    expect(mask.data[10 * w + 24]).toBe(255)
    expect(mask.data[20 * w + 20]).toBe(255)
  })

  it('6. warm garment color similar to light card is not flood-erased', () => {
    const w = 30
    const h = 30
    const image = makeImageData(w, h, [210, 205, 198])
    for (let y = 8; y < 22; y += 1) {
      for (let x = 8; x < 22; x += 1) {
        setRgb(image, x, y, [200, 185, 165])
      }
    }

    const mask = createMaskBuffer(w, h, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[15 * w + 15]).toBe(255)
    expect(mask.data[1 * w + 1]).toBe(0)
  })

  it('7. foreground near background: connected remove from seed only via flood tool', () => {
    const image = makeImageData(9, 9, [200, 200, 200])
    setRgb(image, 4, 4, [195, 195, 195])
    setRgb(image, 0, 0, [30, 90, 180])
    const mask = createMaskBuffer(9, 9, 0)
    // User clicked background seed — connected similar only
    floodSelectSimilar(mask, image, 2, 2, 25, 'keep')
    expect(mask.data[2 * 9 + 2]).toBe(255)
    expect(mask.data[0]).toBe(0)
  })

  it('8. disconnected KEEP regions and internal holes: fill small holes only', () => {
    const mask = createMaskBuffer(20, 20, 0)
    for (let y = 4; y < 16; y += 1) {
      for (let x = 4; x < 16; x += 1) {
        mask.data[y * 20 + x] = 255
      }
    }
    // Internal hole
    mask.data[10 * 20 + 10] = 0
    mask.data[10 * 20 + 11] = 0
    // Disconnected KEEP island
    mask.data[1 * 20 + 1] = 255
    mask.data[1 * 20 + 2] = 255

    fillMaskHoles(mask, 20)
    expect(mask.data[10 * 20 + 10]).toBe(255)
    expect(mask.data[1 * 20 + 1]).toBe(255)

    morphCloseMask(mask, 1)
    expect(mask.data[8 * 20 + 8]).toBe(255)
  })
})

describe('quality pass — editing, transforms, batch independence', () => {
  it('9. manual brush correction survives history undo/redo and stays on mask', () => {
    const mask = createMaskBuffer(16, 16, 0)
    const history = new MaskHistory()
    history.push(mask)
    paintMaskCircle(mask, 4, 4, 3, 'keep')
    expect(mask.data[4 * 16 + 4]).toBe(255)

    const undone = history.undo(mask)
    expect(undone).not.toBeNull()
    expect(undone!.data[4 * 16 + 4]).toBe(0)

    const redone = history.redo(undone!)
    expect(redone).not.toBeNull()
    expect(redone!.data[4 * 16 + 4]).toBe(255)
  })

  it('9b. manual KEEP correction is respected by compositing formula', () => {
    const original = new Uint8ClampedArray([50, 50, 50, 255])
    const background = new Uint8ClampedArray([200, 200, 200, 255])
    const mask = new Uint8ClampedArray([0])
    expect(compositePixelBuffers(original, mask, background)[0]).toBe(200)
    mask[0] = 255
    expect(compositePixelBuffers(original, mask, background)[0]).toBe(50)
  })

  it('10. transform helpers: cardinal rotation swaps bounds; tilt expands AABB', () => {
    expect(rotatedSize(100, 50, 90)).toEqual({ width: 50, height: 100 })
    expect(rotatedSize(100, 50, 0)).toEqual({ width: 100, height: 50 })
    const tilted = rotatedSize(100, 50, 8)
    expect(tilted.width).toBeGreaterThan(100)
    expect(tilted.height).toBeGreaterThan(50)
  })

  it('10b. screen↔image mapping round-trips under scale/pan (mask edit coords)', () => {
    const transform = { scale: 2, offsetX: 10, offsetY: 20 }
    const screen = imageToScreen(40, 30, transform)
    const back = screenToImage(screen.x, screen.y, transform)
    expect(back.x).toBeCloseTo(40)
    expect(back.y).toBeCloseTo(30)
  })

  it('10c. output resize preserves requested catalog dimensions', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 80
    canvas.height = 40
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#112233'
      ctx.fillRect(0, 0, 80, 40)
    }
    const out = applyOutputSize(canvas, 120, 120, 'contain', '#ffffff')
    expect(out.width).toBe(120)
    expect(out.height).toBe(120)
  })

  it('11. identical mask+background composite rules are deterministic', () => {
    const original = new Uint8ClampedArray([100, 0, 0, 255, 0, 100, 0, 255])
    const mask = new Uint8ClampedArray([255, 128])
    const background = new Uint8ClampedArray([0, 0, 50, 255, 0, 0, 50, 255])
    const a = compositePixelBuffers(original, mask, background)
    const b = compositePixelBuffers(original, mask, background)
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(a[0]).toBe(100)
    expect(a[4]).toBe(0)
  })

  it('12. batch images keep independent masks in the store', () => {
    clearAllMasks()
    const a = getOrCreateMask('img-a', 10, 10)
    const b = getOrCreateMask('img-b', 10, 10)
    a.data.fill(255)
    b.data.fill(0)
    setMask('img-a', a)
    setMask('img-b', b)
    expect(getMask('img-a')!.data[0]).toBe(255)
    expect(getMask('img-b')!.data[0]).toBe(0)
    deleteMask('img-a')
    expect(getMask('img-a')).toBeUndefined()
    expect(getMask('img-b')!.data[0]).toBe(0)
    clearAllMasks()
  })

  it('inward feather never raises REMOVE pixels (no studio halo alpha)', () => {
    const mask = createMaskBuffer(12, 12, 0)
    for (let y = 3; y < 9; y += 1) {
      for (let x = 3; x < 9; x += 1) {
        mask.data[y * 12 + x] = 255
      }
    }
    featherMaskEdges(mask, 1)
    expect(mask.data[3 * 12 + 2]).toBe(0)
    expect(mask.data[6 * 12 + 6]).toBe(255)
    const edge = mask.data[3 * 12 + 3]
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)
  })

  it('default adjustments start with shadow off (no forced synthetic shadow)', () => {
    const adj = createDefaultAdjustments()
    expect(adj.shadowOpacity).toBe(0)
    expect(adj.tilt).toBe(0)
  })

  it('6b. foreign blue footer strip is cleared without eating dark hem', () => {
    const w = 40
    const h = 36
    const image = makeImageData(w, h, [220, 220, 220])
    for (let y = 8; y < 26; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        setRgb(image, x, y, [35, 35, 35])
      }
    }
    // Blue UI footer (foreign vs studio)
    for (let y = 30; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        setRgb(image, x, y, [20, 110, 200])
      }
    }
    const mask = createMaskBuffer(w, h, 255)
    stripForeignBorderBands(mask, image)
    expect(mask.data[32 * w + 5]).toBe(0)
    expect(mask.data[18 * w + 18]).toBe(255)
  })

  it('6c. foreign concrete footer differs from studio and is cleared', () => {
    const w = 40
    const h = 36
    const image = makeImageData(w, h, [228, 228, 228])
    for (let y = 8; y < 24; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        setRgb(image, x, y, [20, 20, 20])
      }
    }
    for (let y = 28; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        // Mottled concrete-like strip far from studio gray
        const v = 80 + ((x * 17 + y * 13) % 40)
        setRgb(image, x, y, [v, v - 10, v - 20])
      }
    }
    const mask = createMaskBuffer(w, h, 255)
    stripForeignBorderBands(mask, image)
    expect(mask.data[30 * w + 10]).toBe(0)
    expect(mask.data[16 * w + 16]).toBe(255)
  })

  it('6d. reclaim after strip does not restore concrete footer under dark hem', () => {
    const w = 40
    const h = 40
    const image = makeImageData(w, h, [230, 230, 230])
    for (let y = 8; y < 26; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        setRgb(image, x, y, [25, 25, 25])
      }
    }
    for (let y = 32; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const v = 90 + ((x * 11 + y * 7) % 35)
        setRgb(image, x, y, [v, v - 8, v - 18])
      }
    }
    const mask = createMaskBuffer(w, h, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[36 * w + 5]).toBe(0)
    // Explicit reclaim (as autoMask does after strips) must not reopen footer.
    const corner = averageCornerColor(image)
    reclaimGarmentFromKeep(mask, image, corner, 20, 18)
    stripForeignBorderBands(mask, image)
    expect(mask.data[36 * w + 5]).toBe(0)
    expect(mask.data[16 * w + 16]).toBe(255)
  })

  it('6e. foreign footer height/color/texture variants clear without eating hem', () => {
    const cases: Array<{
      label: string
      h: number
      band: number
      paint: (image: ImageData, y0: number, w: number, h: number) => void
    }> = [
      {
        label: 'thin-blue',
        h: 40,
        band: 4,
        paint: (image, y0, w, h) => {
          for (let y = y0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) setRgb(image, x, y, [30, 100, 210])
          }
        },
      },
      {
        label: 'tall-gradient-blue',
        h: 48,
        band: 12,
        paint: (image, y0, w, h) => {
          for (let y = y0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
              const t = x / (w - 1)
              setRgb(image, x, y, [
                Math.round(40 + t * 30),
                Math.round(110 + t * 50),
                Math.round(190 + t * 50),
              ])
            }
          }
        },
      },
      {
        label: 'white-then-beige-room',
        h: 44,
        band: 10,
        paint: (image, y0, w, h) => {
          for (let y = y0; y < y0 + 2; y += 1) {
            for (let x = 0; x < w; x += 1) setRgb(image, x, y, [250, 250, 250])
          }
          for (let y = y0 + 2; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
              const left = x < w / 2
              setRgb(image, x, y, left ? [40, 35, 30] : [210, 195, 175])
            }
          }
        },
      },
      {
        label: 'mottled-concrete',
        h: 42,
        band: 8,
        paint: (image, y0, w, h) => {
          for (let y = y0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
              const v = 70 + ((x * 19 + y * 11) % 50)
              setRgb(image, x, y, [v, v - 12, v - 22])
            }
          }
        },
      },
    ]

    for (const c of cases) {
      const w = 36
      const image = makeImageData(w, c.h, [224, 224, 224])
      // Dark hem approaches but does not enter the band
      for (let y = 8; y < c.h - c.band - 2; y += 1) {
        for (let x = 10; x < 26; x += 1) {
          setRgb(image, x, y, [28, 28, 28])
        }
      }
      c.paint(image, c.h - c.band, w, c.h)
      const mask = createMaskBuffer(w, c.h, 255)
      stripForeignBorderBands(mask, image)
      // Band cleared
      expect(mask.data[(c.h - 1) * w + 3], c.label).toBe(0)
      expect(mask.data[(c.h - c.band + 1) * w + 8], c.label).toBe(0)
      // Garment body kept
      expect(mask.data[14 * w + 18], c.label).toBe(255)
    }
  })

  it('6f. garment touching bottom border is not wiped as a foreign band', () => {
    const w = 32
    const h = 32
    const image = makeImageData(w, h, [222, 222, 222])
    for (let y = 10; y < h; y += 1) {
      for (let x = 8; x < 24; x += 1) {
        setRgb(image, x, y, [22, 22, 22])
      }
    }
    const mask = createMaskBuffer(w, h, 255)
    stripForeignBorderBands(mask, image)
    expect(mask.data[(h - 1) * w + 16]).toBe(255)
    expect(mask.data[2 * w + 2]).toBe(255) // studio still KEEP until other passes
  })

  it('4b. chromatic dress hem: studio AA next to mauve is peeled, body kept', () => {
    const w = 36
    const h = 36
    const image = makeImageData(w, h, [224, 224, 224])
    for (let y = 10; y < 28; y += 1) {
      for (let x = 12; x < 24; x += 1) {
        setRgb(image, x, y, [180, 120, 140]) // mauve satin
      }
    }
    // 1px near-white AA ring
    for (let y = 9; y < 29; y += 1) {
      setRgb(image, 11, y, [236, 236, 236])
      setRgb(image, 24, y, [236, 236, 236])
    }
    for (let x = 11; x < 25; x += 1) {
      setRgb(image, x, 9, [236, 236, 236])
      setRgb(image, x, 28, [236, 236, 236])
    }
    const mask = createMaskBuffer(w, h, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[18 * w + 18]).toBe(255)
    expect(mask.data[2 * w + 2]).toBe(0)
    expect(mask.data[9 * w + 11]).toBe(0)
    expect(mask.data[18 * w + 11]).toBe(0)
  })

  it('4c. detached studio flecks are cleared without eating thin straps', () => {
    const w = 40
    const h = 40
    const image = makeImageData(w, h, [228, 228, 228])
    // Dark body
    for (let y = 14; y < 30; y += 1) {
      for (let x = 14; x < 26; x += 1) {
        setRgb(image, x, y, [30, 30, 30])
      }
    }
    // Thin dark strap (must survive)
    for (let y = 8; y < 14; y += 1) {
      setRgb(image, 19, y, [35, 35, 35])
      setRgb(image, 20, y, [35, 35, 35])
    }
    const mask = createMaskBuffer(w, h, 255)
    // Simulate leftover flecks after partial remove
    mask.data.fill(0)
    for (let y = 14; y < 30; y += 1) {
      for (let x = 14; x < 26; x += 1) {
        mask.data[y * w + x] = 255
      }
    }
    for (let y = 8; y < 14; y += 1) {
      mask.data[y * w + 19] = 255
      mask.data[y * w + 20] = 255
    }
    // Detached studio fleck island
    for (let y = 3; y < 6; y += 1) {
      for (let x = 3; x < 7; x += 1) {
        mask.data[y * w + x] = 255
      }
    }
    stripDetachedStudioIslands(mask, image, 40)
    expect(mask.data[4 * w + 4]).toBe(0)
    expect(mask.data[20 * w + 20]).toBe(255)
    expect(mask.data[10 * w + 19]).toBe(255)
  })

  it('4d. enclosed handle pocket clears while dark walls stay', () => {
    const w = 36
    const h = 36
    const image = makeImageData(w, h, [229, 229, 229])
    for (let y = 8; y < 28; y += 1) {
      for (let x = 8; x < 12; x += 1) setRgb(image, x, y, [28, 28, 28])
      for (let x = 24; x < 28; x += 1) setRgb(image, x, y, [28, 28, 28])
    }
    for (let x = 8; x < 28; x += 1) {
      for (let y = 24; y < 28; y += 1) setRgb(image, x, y, [28, 28, 28])
    }
    // Slightly lifted enclosed card (JPEG-like, within studio+1 band)
    for (let y = 12; y < 20; y += 1) {
      for (let x = 13; x < 23; x += 1) {
        setRgb(image, x, y, [230, 230, 230])
      }
    }
    const mask = createMaskBuffer(w, h, 255)
    // Outer already removed; walls + pocket KEEP
    mask.data.fill(0)
    for (let y = 8; y < 28; y += 1) {
      for (let x = 8; x < 12; x += 1) mask.data[y * w + x] = 255
      for (let x = 24; x < 28; x += 1) mask.data[y * w + x] = 255
    }
    for (let x = 8; x < 28; x += 1) {
      for (let y = 24; y < 28; y += 1) mask.data[y * w + x] = 255
    }
    for (let y = 12; y < 20; y += 1) {
      for (let x = 13; x < 23; x += 1) mask.data[y * w + x] = 255
    }
    stripEnclosedFlatStudio(mask, image, 40)
    expect(mask.data[16 * w + 18]).toBe(0)
    expect(mask.data[16 * w + 9]).toBe(255)
  })

  it('4e. dark-walled pocket clears JPEG-lifted handle hole; white leather panel stays', () => {
    const w = 40
    const h = 40
    const image = makeImageData(w, h, [229, 229, 229])
    // Closed dark frame (handle walls) — pocket must share edges with walls
    for (let y = 8; y < 28; y += 1) {
      for (let x = 8; x < 12; x += 1) setRgb(image, x, y, [24, 24, 24])
      for (let x = 28; x < 32; x += 1) setRgb(image, x, y, [24, 24, 24])
    }
    for (let x = 8; x < 32; x += 1) {
      for (let y = 8; y < 12; y += 1) setRgb(image, x, y, [24, 24, 24])
      for (let y = 24; y < 28; y += 1) setRgb(image, x, y, [24, 24, 24])
    }
    // Handle hole: JPEG-lifted card adjacent to dark walls
    for (let y = 12; y < 24; y += 1) {
      for (let x = 12; x < 28; x += 1) {
        setRgb(image, x, y, [248, 248, 248])
      }
    }
    // White leather panel with only a dark sole contact (low dark-wall ratio)
    for (let y = 8; y < 20; y += 1) {
      for (let x = 2; x < 6; x += 1) {
        setRgb(image, x, y, [236, 236, 236])
      }
    }
    for (let x = 2; x < 6; x += 1) setRgb(image, x, 20, [20, 20, 20])

    const mask = createMaskBuffer(w, h, 0)
    for (let y = 8; y < 28; y += 1) {
      for (let x = 8; x < 12; x += 1) mask.data[y * w + x] = 255
      for (let x = 28; x < 32; x += 1) mask.data[y * w + x] = 255
    }
    for (let x = 8; x < 32; x += 1) {
      for (let y = 8; y < 12; y += 1) mask.data[y * w + x] = 255
      for (let y = 24; y < 28; y += 1) mask.data[y * w + x] = 255
    }
    for (let y = 12; y < 24; y += 1) {
      for (let x = 12; x < 28; x += 1) mask.data[y * w + x] = 255
    }
    for (let y = 8; y < 21; y += 1) {
      for (let x = 2; x < 6; x += 1) mask.data[y * w + x] = 255
    }

    stripDarkWalledStudioPockets(mask, image, 40)
    expect(mask.data[18 * w + 20]).toBe(0) // handle hole cleared
    expect(mask.data[18 * w + 9]).toBe(255) // dark wall kept
    expect(mask.data[12 * w + 3]).toBe(255) // white leather panel kept
  })

  it('4i. border studio strip preserves dark-connected pale leather panel', () => {
    const w = 40
    const h = 40
    const image = makeImageData(w, h, [226, 226, 226])
    // Pale leather panel
    for (let y = 10; y < 28; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        setRgb(image, x, y, [232, 232, 232])
      }
    }
    // Dark sole
    for (let y = 28; y < 32; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        setRgb(image, x, y, [25, 25, 25])
      }
    }
    const mask = createMaskBuffer(w, h, 255)
    stripBorderConnectedStudio(mask, image, 40)
    // Outer card cleared
    expect(mask.data[1 * w + 1]).toBe(0)
    // Leather + sole kept
    expect(mask.data[18 * w + 20]).toBe(255)
    expect(mask.data[30 * w + 20]).toBe(255)
  })

  it('4h. open-arch studio between dark walls clears; white leather panel stays', () => {
    const w = 40
    const h = 28
    const image = makeImageData(w, h, [229, 229, 229])
    // Two vertical dark handle walls with studio gap (open top = arch)
    for (let y = 4; y < 24; y += 1) {
      for (let x = 10; x < 14; x += 1) setRgb(image, x, y, [20, 20, 20])
      for (let x = 26; x < 30; x += 1) setRgb(image, x, y, [20, 20, 20])
    }
    for (let y = 6; y < 18; y += 1) {
      for (let x = 14; x < 26; x += 1) setRgb(image, x, y, [236, 236, 236])
    }
    // White leather panel with sole (single dark contact)
    for (let y = 6; y < 18; y += 1) {
      for (let x = 1; x < 6; x += 1) setRgb(image, x, y, [240, 240, 240])
    }
    for (let x = 1; x < 6; x += 1) setRgb(image, x, 18, [18, 18, 18])

    const mask = createMaskBuffer(w, h, 0)
    for (let y = 4; y < 24; y += 1) {
      for (let x = 10; x < 14; x += 1) mask.data[y * w + x] = 255
      for (let x = 26; x < 30; x += 1) mask.data[y * w + x] = 255
    }
    for (let y = 6; y < 18; y += 1) {
      for (let x = 14; x < 26; x += 1) mask.data[y * w + x] = 255
    }
    for (let y = 6; y < 19; y += 1) {
      for (let x = 1; x < 6; x += 1) mask.data[y * w + x] = 255
    }

    stripOpenArchStudio(mask, image, 40)
    expect(mask.data[12 * w + 20]).toBe(0)
    expect(mask.data[12 * w + 11]).toBe(255)
    expect(mask.data[10 * w + 3]).toBe(255)
  })

  it('4g. choke peels card-level AA against dark walls without eating lifted leather', () => {
    const w = 32
    const h = 32
    const image = makeImageData(w, h, [229, 229, 229])
    // Dark rectangle with 1px card-level AA ring (studio match, not lifted leather)
    for (let y = 10; y < 22; y += 1) {
      for (let x = 10; x < 22; x += 1) setRgb(image, x, y, [20, 20, 20])
    }
    for (let y = 9; y < 23; y += 1) {
      setRgb(image, 9, y, [229, 229, 229])
      setRgb(image, 22, y, [229, 229, 229])
    }
    for (let x = 9; x < 23; x += 1) {
      setRgb(image, x, 9, [229, 229, 229])
      setRgb(image, x, 22, [229, 229, 229])
    }
    // Clear REMOVE outside so AA touches REMOVE (silhouette fringe)
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 10; y < 22; y += 1) {
      for (let x = 10; x < 22; x += 1) mask.data[y * w + x] = 255
    }
    for (let y = 9; y < 23; y += 1) {
      mask.data[y * w + 9] = 255
      mask.data[y * w + 22] = 255
    }
    for (let x = 9; x < 23; x += 1) {
      mask.data[9 * w + x] = 255
      mask.data[22 * w + x] = 255
    }
    // Lifted white leather panel + sole
    for (let y = 4; y < 14; y += 1) {
      for (let x = 1; x < 6; x += 1) {
        setRgb(image, x, y, [240, 240, 240])
        mask.data[y * w + x] = 255
      }
    }
    for (let x = 1; x < 6; x += 1) {
      setRgb(image, x, 14, [16, 16, 16])
      mask.data[14 * w + x] = 255
    }

    chokeBrightStudioBesideDark(mask, image, 40, 4)
    expect(mask.data[9 * w + 15]).toBe(0) // card-level AA peeled
    expect(mask.data[15 * w + 15]).toBe(255) // dark body kept
    expect(mask.data[8 * w + 3]).toBe(255) // lifted leather kept
  })

  it('4f. chromatic enclosed detail is not stripped as a handle hole', () => {
    const w = 32
    const h = 32
    const image = makeImageData(w, h, [229, 229, 229])
    for (let y = 6; y < 26; y += 1) {
      for (let x = 6; x < 10; x += 1) setRgb(image, x, y, [30, 30, 30])
      for (let x = 22; x < 26; x += 1) setRgb(image, x, y, [30, 30, 30])
    }
    for (let x = 6; x < 26; x += 1) {
      for (let y = 22; y < 26; y += 1) setRgb(image, x, y, [30, 30, 30])
    }
    // Gold hardware / chromatic interior (not studio)
    for (let y = 10; y < 18; y += 1) {
      for (let x = 11; x < 21; x += 1) {
        setRgb(image, x, y, [190, 150, 60])
      }
    }
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 6; y < 26; y += 1) {
      for (let x = 6; x < 10; x += 1) mask.data[y * w + x] = 255
      for (let x = 22; x < 26; x += 1) mask.data[y * w + x] = 255
    }
    for (let x = 6; x < 26; x += 1) {
      for (let y = 22; y < 26; y += 1) mask.data[y * w + x] = 255
    }
    for (let y = 10; y < 18; y += 1) {
      for (let x = 11; x < 21; x += 1) mask.data[y * w + x] = 255
    }
    stripDarkWalledStudioPockets(mask, image, 40)
    expect(mask.data[14 * w + 16]).toBe(255)
  })

  it('1b. flat white leather above near-white card survives corner remove', () => {
    const w = 36
    const h = 36
    const image = makeImageData(w, h, [226, 226, 226])
    for (let y = 10; y < 28; y += 1) {
      for (let x = 10; x < 26; x += 1) {
        // Flat white leather ~card+4 (sneaker panels)
        setRgb(image, x, y, [230, 230, 230])
      }
    }
    // Dark sole accents so reclaim has a seed
    for (let x = 12; x < 24; x += 1) {
      setRgb(image, x, 26, [30, 30, 30])
      setRgb(image, x, 27, [25, 25, 25])
    }
    const mask = createMaskBuffer(w, h, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[2 * w + 2]).toBe(0)
    expect(mask.data[18 * w + 18]).toBe(255)
    expect(mask.data[14 * w + 14]).toBe(255)
    expect(mask.data[26 * w + 18]).toBe(255)
  })

  it('15. auto corner remove is deterministic for identical inputs', () => {
    const w = 28
    const h = 28
    const image = makeImageData(w, h, [218, 218, 218])
    for (let y = 8; y < 20; y += 1) {
      for (let x = 8; x < 20; x += 1) {
        setRgb(image, x, y, [40, 40, 40])
      }
    }
    const a = createMaskBuffer(w, h, 255)
    const b = createMaskBuffer(w, h, 255)
    removeSimilarToCorners(a, image, 40)
    removeSimilarToCorners(b, image, 40)
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })
})

describe('quality pass — export resolution contract', () => {
  it('12. renderFinal keeps native dimensions when no output resize is set', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 600
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#334455'
      ctx.fillRect(0, 0, 800, 600)
    }
    // Mimic pipeline: adjustments with null output size leave size unchanged.
    const adj = createDefaultAdjustments()
    expect(adj.outputWidth).toBeNull()
    expect(adj.outputHeight).toBeNull()
    const out = applyOutputSize(
      canvas,
      adj.outputWidth,
      adj.outputHeight,
      adj.outputFit,
      adj.outputPadColor,
    )
    expect(out.width).toBe(800)
    expect(out.height).toBe(600)
    expect(out).toBe(canvas)
  })

  it('12b. high-resolution source is not silently downscaled to thumbnail size', () => {
    // Simulate a full-res decode (e.g. 1600×1600 product shot) vs a gallery
    // thumbnail (294×291). Export must use the source dimensions, never the thumb.
    const SOURCE_W = 1600
    const SOURCE_H = 1600
    const THUMB_W = 294
    const THUMB_H = 291

    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = SOURCE_W
    sourceCanvas.height = SOURCE_H

    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = THUMB_W
    thumbCanvas.height = THUMB_H

    const adj = createDefaultAdjustments()
    expect(adj.outputWidth).toBeNull()
    expect(adj.outputHeight).toBeNull()

    const exported = applyOutputSize(
      sourceCanvas,
      adj.outputWidth,
      adj.outputHeight,
      adj.outputFit,
      adj.outputPadColor,
    )
    expect(exported.width).toBe(SOURCE_W)
    expect(exported.height).toBe(SOURCE_H)
    expect(exported.width).not.toBe(THUMB_W)
    expect(exported.height).not.toBe(THUMB_H)
    // Thumbnail must never be the export input when null output size is set.
    expect(thumbCanvas.width).toBe(THUMB_W)
    expect(exported).toBe(sourceCanvas)
  })
})
