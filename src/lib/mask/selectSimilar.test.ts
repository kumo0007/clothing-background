import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from './createMask'
import {
  floodSelectSimilar,
  globalSelectSimilar,
  removeBrightEdgeChrome,
  removeSimilarToCorners,
} from './selectSimilar'

function makeImageData(width: number, height: number, fill: [number, number, number]): ImageData {
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

describe('selectSimilar', () => {
  it('keeps only connected similar pixels with flood fill', () => {
    const image = makeImageData(5, 5, [200, 200, 200])
    // Blue blob at center, disconnected blue at corner
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const o = (y * 5 + x) * 4
      image.data[o] = rgb[0]
      image.data[o + 1] = rgb[1]
      image.data[o + 2] = rgb[2]
    }
    set(2, 2, [30, 90, 180])
    set(2, 3, [30, 90, 180])
    set(0, 0, [30, 90, 180])

    const mask = createMaskBuffer(5, 5, 0)
    const painted = floodSelectSimilar(mask, image, 2, 2, 20, 'keep')
    expect(painted).toBe(2)
    expect(mask.data[2 * 5 + 2]).toBe(255)
    expect(mask.data[3 * 5 + 2]).toBe(255)
    expect(mask.data[0]).toBe(0)
  })

  it('global select paints all matching colors', () => {
    const image = makeImageData(3, 1, [10, 10, 10])
    image.data[0] = 30
    image.data[1] = 90
    image.data[2] = 180
    image.data[8] = 30
    image.data[9] = 90
    image.data[10] = 180

    const mask = createMaskBuffer(3, 1, 0)
    const painted = globalSelectSimilar(mask, image, 0, 0, 5, 'keep')
    expect(painted).toBe(2)
    expect(mask.data[0]).toBe(255)
    expect(mask.data[1]).toBe(0)
    expect(mask.data[2]).toBe(255)
  })

  it('corner remove floods backdrop and keeps dark garment pixels', () => {
    const size = 9
    const image = makeImageData(size, size, [220, 220, 220])
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const o = (y * size + x) * 4
      image.data[o] = rgb[0]
      image.data[o + 1] = rgb[1]
      image.data[o + 2] = rgb[2]
    }
    for (let x = 3; x <= 5; x += 1) {
      set(x, 3, [40, 40, 40])
      set(x, 5, [40, 40, 40])
    }
    for (let y = 3; y <= 5; y += 1) {
      set(3, y, [40, 40, 40])
      set(5, y, [40, 40, 40])
    }
    set(4, 4, [40, 40, 40])

    const mask = createMaskBuffer(size, size, 255)
    removeSimilarToCorners(mask, image, 30)
    expect(mask.data[2 * size + 2]).toBe(0) // corner seed removed
    expect(mask.data[0]).toBe(0) // outer backdrop removed
    expect(mask.data[4 * size + 4]).toBe(255) // dark garment kept
    expect(mask.data[3 * size + 3]).toBe(255)
  })

  it('chokes near-white AA sitting on a mid-gray ring around a dark bag', () => {
    const width = 28
    const height = 28
    const image = makeImageData(width, height, [228, 228, 228])
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const o = (y * width + x) * 4
      image.data[o] = rgb[0]
      image.data[o + 1] = rgb[1]
      image.data[o + 2] = rgb[2]
    }
    for (let y = 8; y < 20; y += 1) {
      for (let x = 8; x < 20; x += 1) {
        set(x, y, [35, 35, 35])
      }
    }
    // Mid-gray soft ring
    for (let y = 7; y < 21; y += 1) {
      set(7, y, [150, 150, 150])
      set(20, y, [150, 150, 150])
    }
    for (let x = 7; x < 21; x += 1) {
      set(x, 7, [150, 150, 150])
      set(x, 20, [150, 150, 150])
    }
    // Near-white AA outside the gray ring (outside studio tol from 228)
    for (let y = 6; y < 22; y += 1) {
      set(6, y, [250, 250, 250])
      set(21, y, [250, 250, 250])
    }
    for (let x = 6; x < 22; x += 1) {
      set(x, 6, [250, 250, 250])
      set(x, 21, [250, 250, 250])
    }

    const mask = createMaskBuffer(width, height, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[6 * width + 6]).toBe(0)
    expect(mask.data[7 * width + 7]).toBe(0)
    expect(mask.data[14 * width + 14]).toBe(255)
    expect(mask.data[2 * width + 2]).toBe(0)
  })

  it('chokes a thick mid-gray soft-shadow band around a dark puffer', () => {
    // Large enough that outer halo pixels sit outside the dark body' s 5×5 window.
    const width = 48
    const height = 48
    const image = makeImageData(width, height, [210, 210, 210])
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const o = (y * width + x) * 4
      image.data[o] = rgb[0]
      image.data[o + 1] = rgb[1]
      image.data[o + 2] = rgb[2]
    }
    for (let y = 18; y < 30; y += 1) {
      for (let x = 18; x < 30; x += 1) {
        set(x, y, [30, 30, 30])
      }
    }
    // 6px similar mid-gray halo (outer rings are flat; peel outside-in)
    for (let inset = 0; inset < 6; inset += 1) {
      const lo = 12 + inset
      const hi = 35 - inset
      for (let y = lo; y <= hi; y += 1) {
        set(lo, y, [120, 120, 120])
        set(hi, y, [120, 120, 120])
      }
      for (let x = lo; x <= hi; x += 1) {
        set(x, lo, [120, 120, 120])
        set(x, hi, [120, 120, 120])
      }
    }

    const mask = createMaskBuffer(width, height, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[12 * width + 12]).toBe(0)
    expect(mask.data[14 * width + 14]).toBe(0)
    expect(mask.data[16 * width + 16]).toBe(0)
    expect(mask.data[24 * width + 24]).toBe(255)
  })

  it('chokes bright studio fringe that touches remove around a dark garment', () => {
    const width = 30
    const height = 30
    const image = makeImageData(width, height, [230, 230, 230])
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const o = (y * width + x) * 4
      image.data[o] = rgb[0]
      image.data[o + 1] = rgb[1]
      image.data[o + 2] = rgb[2]
    }
    // Dark bag body
    for (let y = 8; y < 22; y += 1) {
      for (let x = 8; x < 22; x += 1) {
        set(x, y, [40, 40, 40])
      }
    }
    // One-pixel bright AA ring around the bag
    for (let y = 7; y < 23; y += 1) {
      set(7, y, [235, 235, 235])
      set(22, y, [235, 235, 235])
    }
    for (let x = 7; x < 23; x += 1) {
      set(x, 7, [235, 235, 235])
      set(x, 22, [235, 235, 235])
    }

    const mask = createMaskBuffer(width, height, 255)
    removeSimilarToCorners(mask, image, 40)
    // Backdrop + AA ring should be remove; dark body kept
    expect(mask.data[7 * width + 7]).toBe(0)
    expect(mask.data[10 * width + 10]).toBe(255)
    expect(mask.data[2 * width + 2]).toBe(0)
  })

  it('floods past a bright chrome column that would otherwise block the card', () => {
    const width = 40
    const height = 30
    const image = makeImageData(width, height, [220, 220, 220])
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const o = (y * width + x) * 4
      image.data[o] = rgb[0]
      image.data[o + 1] = rgb[1]
      image.data[o + 2] = rgb[2]
    }
    // Full-height white chrome near left edge (catalog artifact)
    for (let y = 0; y < height; y += 1) {
      set(3, y, [255, 255, 255])
      set(4, y, [255, 255, 255])
    }
    // Dark garment on the right half
    for (let y = 6; y < 24; y += 1) {
      for (let x = 18; x < 34; x += 1) {
        set(x, y, [40, 50, 60])
      }
    }

    const mask = createMaskBuffer(width, height, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[10 * width + 3]).toBe(0) // chrome cleared
    expect(mask.data[2 * width + 12]).toBe(0) // gray past chrome removed
    expect(mask.data[15 * width + 25]).toBe(255) // garment kept
  })

  it('corner remove keeps textured light pixels connected to the backdrop', () => {
    const size = 11
    const image = makeImageData(size, size, [230, 230, 230])
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const o = (y * size + x) * 4
      image.data[o] = rgb[0]
      image.data[o + 1] = rgb[1]
      image.data[o + 2] = rgb[2]
    }
    // Chromatic checker (not neutral gray) so fringe choke does not treat it
    // as soft-shadow / white AA while flat studio remove still skips texture.
    for (let y = 3; y <= 7; y += 1) {
      for (let x = 3; x <= 7; x += 1) {
        const light = (x + y) % 2 === 0
        set(x, y, light ? [250, 220, 190] : [160, 190, 220])
      }
    }

    const mask = createMaskBuffer(size, size, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[2]).toBe(0) // flat backdrop removed
    // Textured center must remain KEEP
    expect(mask.data[5 * size + 5]).toBe(255)
  })

  it('strips near-white full-height chrome columns near the edge', () => {
    const width = 40
    const height = 30
    const image = makeImageData(width, height, [220, 220, 220])
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const o = (y * width + x) * 4
      image.data[o] = rgb[0]
      image.data[o + 1] = rgb[1]
      image.data[o + 2] = rgb[2]
    }
    for (let y = 0; y < height; y += 1) {
      set(4, y, [255, 255, 255])
      set(5, y, [254, 254, 254])
    }
    // Partial chrome column (~77% bright) still qualifies
    for (let y = 0; y < 23; y += 1) {
      set(6, y, [255, 255, 255])
    }
    // Center garment stays
    for (let y = 8; y < 22; y += 1) {
      for (let x = 12; x < 28; x += 1) {
        set(x, y, [40, 40, 40])
      }
    }

    const mask = createMaskBuffer(width, height, 255)
    removeBrightEdgeChrome(mask, image)
    expect(mask.data[10 * width + 4]).toBe(0)
    expect(mask.data[10 * width + 5]).toBe(0)
    expect(mask.data[10 * width + 6]).toBe(0)
    expect(mask.data[15 * width + 20]).toBe(255)
  })

  it('keeps flat white garment fabric brighter than the gray studio card', () => {
    const width = 36
    const height = 36
    const image = makeImageData(width, height, [215, 215, 215])
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const o = (y * width + x) * 4
      image.data[o] = rgb[0]
      image.data[o + 1] = rgb[1]
      image.data[o + 2] = rgb[2]
    }
    // Flat white tee body (low variance) — previously flood-eaten via AA ramp.
    for (let y = 10; y < 28; y += 1) {
      for (let x = 10; x < 26; x += 1) {
        set(x, y, [248, 248, 250])
      }
    }

    const mask = createMaskBuffer(width, height, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[2 * width + 2]).toBe(0)
    expect(mask.data[18 * width + 18]).toBe(255)
    expect(mask.data[12 * width + 12]).toBe(255)
    expect(mask.data[20 * width + 14]).toBe(255)
  })

  it('strips saturated gradient footer chrome rows near the edge', () => {
    const width = 40
    const height = 30
    const image = makeImageData(width, height, [220, 220, 220])
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const o = (y * width + x) * 4
      image.data[o] = rgb[0]
      image.data[o + 1] = rgb[1]
      image.data[o + 2] = rgb[2]
    }
    // Dark bag body
    for (let y = 6; y < 20; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        set(x, y, [35, 35, 35])
      }
    }
    // Blue gradient footer (high row variance — mean-chroma alone used to miss)
    for (let y = 26; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const t = x / (width - 1)
        set(x, y, [
          Math.round(40 + t * 20),
          Math.round(120 + t * 40),
          Math.round(200 + t * 40),
        ])
      }
    }

    const mask = createMaskBuffer(width, height, 255)
    removeBrightEdgeChrome(mask, image)
    expect(mask.data[28 * width + 5]).toBe(0)
    expect(mask.data[28 * width + 20]).toBe(0)
    expect(mask.data[12 * width + 20]).toBe(255)
  })

  it('reclaims light garment fabric around a dark logo after corner remove', () => {
    const size = 21
    const image = makeImageData(size, size, [230, 230, 230])
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const o = (y * size + x) * 4
      image.data[o] = rgb[0]
      image.data[o + 1] = rgb[1]
      image.data[o + 2] = rgb[2]
    }
    // Beige cap body (close to gray bg) with a dark logo seed in the middle
    for (let y = 5; y <= 15; y += 1) {
      for (let x = 5; x <= 15; x += 1) {
        set(x, y, [220, 210, 195])
      }
    }
    set(10, 10, [20, 20, 20])
    set(11, 10, [20, 20, 20])
    set(10, 11, [20, 20, 20])

    const mask = createMaskBuffer(size, size, 255)
    removeSimilarToCorners(mask, image, 40)
    expect(mask.data[2 * size + 2]).toBe(0) // backdrop cleared
    expect(mask.data[10 * size + 10]).toBe(255) // logo kept
    expect(mask.data[8 * size + 8]).toBe(255) // beige fabric reclaimed
    expect(mask.data[14 * size + 14]).toBe(255)
  })
})
