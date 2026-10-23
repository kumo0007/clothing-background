import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { segmentGarmentBySeeds } from '../src/lib/mask/opencv/segmentSeeds'
import { createMaskBuffer } from '../src/lib/mask/createMask'
import { averageCornerColor, stripBorderConnectedStudio } from '../src/lib/mask/selectSimilar'

const raw = readFileSync('public/testdata/clothing/10_cap.jpg')
const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
const imageData = {
  width: d.width,
  height: d.height,
  data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
  colorSpace: 'srgb',
} as ImageData
const corner = averageCornerColor(imageData)
const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
const seed = segmentGarmentBySeeds(imageData)
const mask = createMaskBuffer(d.width, d.height, 0)
mask.data.set(seed.mask.data)

let top255 = 0
const samples: Array<{ x: number; v: number; rgb: number[]; L: number }> = []
for (let x = 0; x < d.width; x += 1) {
  const v = mask.data[x]!
  if (v === 255) top255 += 1
  if (v >= 128 && samples.length < 8) {
    const o = x * 4
    const r = imageData.data[o]!
    const g = imageData.data[o + 1]!
    const b = imageData.data[o + 2]!
    const L = 0.299 * r + 0.587 * g + 0.114 * b
    samples.push({ x, v, rgb: [r, g, b], L })
  }
}
console.log({ top255, studioLuma, samples })

const painted = stripBorderConnectedStudio(mask, imageData, 40)
let topAfter = 0
for (let x = 0; x < d.width; x += 1) if (mask.data[x]! >= 128) topAfter += 1
console.log({
  painted,
  topAfter,
  keep: [...mask.data].filter((v) => v >= 128).length,
})
