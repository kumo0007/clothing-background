/**
 * Probe why handbag handle interiors remain KEEP.
 * Run: npx vite-node scripts/probeHandbagHoles.mts
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
import {
  averageCornerColor,
  localLumaVariance,
  stripEnclosedFlatStudio,
} from '../src/lib/mask/selectSimilar'
import { createMaskBuffer } from '../src/lib/mask/createMask'
import { segmentGarmentWithOpenCv } from '../src/lib/mask/opencv/segmentGarment'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const path = join(root, 'public', 'testdata', 'clothing', '09_handbag.jpg')

const raw = readFileSync(path)
const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
const imageData = {
  width: d.width,
  height: d.height,
  data: new Uint8ClampedArray(
    d.data.buffer,
    d.data.byteOffset,
    d.data.byteLength,
  ),
  colorSpace: 'srgb',
} as ImageData

const corner = averageCornerColor(imageData)
const studioLuma =
  0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
console.log({ corner, studioLuma: +studioLuma.toFixed(2) })

const seg = await segmentGarmentWithOpenCv(imageData)
console.log('seed method', seg.methodUsed)

const afterSeed = createMaskBuffer(imageData.width, imageData.height, 0)
afterSeed.data.set(seg.mask.data)

let seedBrightKeep = 0
let seedBrightRemove = 0
for (let i = 0; i < afterSeed.data.length; i += 1) {
  const o = i * 4
  const r = imageData.data[o]!
  const g = imageData.data[o + 1]!
  const b = imageData.data[o + 2]!
  const L = 0.299 * r + 0.587 * g + 0.114 * b
  const chroma = Math.max(r, g, b) - Math.min(r, g, b)
  if (L < 170 || chroma > 22) continue
  if (afterSeed.data[i]! >= 200) seedBrightKeep += 1
  else seedBrightRemove += 1
}
console.log({ seedBrightKeep, seedBrightRemove })

const painted = stripEnclosedFlatStudio(afterSeed, imageData, 40)
console.log('stripEnclosed on seed mask painted', painted)

const full = await runAutoMaskPipeline(imageData, 'opencv')
console.log('full method', full.methodUsed, full.elapsedMs)

const samples: Array<Record<string, number>> = []
for (let y = 60; y < 140; y += 4) {
  for (let x = 90; x < 210; x += 4) {
    const i = y * full.mask.width + x
    const o = i * 4
    const r = imageData.data[o]!
    const g = imageData.data[o + 1]!
    const b = imageData.data[o + 2]!
    const L = 0.299 * r + 0.587 * g + 0.114 * b
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    const dist = Math.hypot(r - corner.r, g - corner.g, b - corner.b)
    const v = localLumaVariance(imageData, x, y, 1)
    if (full.mask.data[i]! >= 128 && L > 150 && chroma < 30) {
      samples.push({
        x,
        y,
        m: full.mask.data[i]!,
        L: +L.toFixed(1),
        chroma,
        dist: +dist.toFixed(1),
        v: +v.toFixed(2),
        aboveStudio: +(L - studioLuma).toFixed(1),
      })
    }
  }
}
console.log('brightish KEEP in handle band', samples.length)
console.log(JSON.stringify(samples.slice(0, 30), null, 2))

let fullBrightKeep = 0
for (let y = 1; y < full.mask.height - 1; y += 1) {
  for (let x = 1; x < full.mask.width - 1; x += 1) {
    const i = y * full.mask.width + x
    if (full.mask.data[i]! < 200) continue
    const o = i * 4
    const r = imageData.data[o]!
    const g = imageData.data[o + 1]!
    const b = imageData.data[o + 2]!
    const L = 0.299 * r + 0.587 * g + 0.114 * b
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    if (L >= 160 && chroma <= 24) fullBrightKeep += 1
  }
}
console.log({ fullBrightKeep })
