/**
 * Diagnose sneaker white-leather loss through seed → pipeline stages.
 * Run: npx vite-node scripts/probeSneakerMask.mts
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { segmentGarmentBySeeds } from '../src/lib/mask/opencv/segmentSeeds'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
import { averageCornerColor, localLumaVariance } from '../src/lib/mask/selectSimilar'
import { createMaskBuffer } from '../src/lib/mask/createMask'
import {
  fillMaskHoles,
  featherMaskEdges,
} from '../src/lib/mask/refineMask'
import {
  reclaimGarmentFromKeep,
  stripBorderConnectedStudio,
  stripEnclosedFlatStudio,
  stripOpenArchStudio,
  chokeBrightStudioBesideDark,
  stripForeignBorderBands,
  stripDetachedStudioIslands,
  chokeMaskEdgeFringe,
  removeBrightEdgeChrome,
} from '../src/lib/mask/selectSimilar'
import { refineSilhouetteBoundary } from '../src/lib/mask/refineBoundary'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const path = join(root, 'public', 'testdata', 'clothing', '08_sneakers.jpg')
const raw = readFileSync(path)
const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
const imageData = {
  width: d.width,
  height: d.height,
  data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
  colorSpace: 'srgb',
} as ImageData

const corner = averageCornerColor(imageData)
const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
console.log({ corner, studioLuma: +studioLuma.toFixed(2) })

function stats(label: string, mask: { data: Uint8ClampedArray; width: number }) {
  let keep = 0
  let paleKeep = 0
  let paleRemove = 0
  let darkKeep = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    const o = i * 4
    const r = imageData.data[o]!
    const g = imageData.data[o + 1]!
    const b = imageData.data[o + 2]!
    const L = 0.299 * r + 0.587 * g + 0.114 * b
    const c = Math.max(r, g, b) - Math.min(r, g, b)
    const m = mask.data[i]!
    if (m >= 128) {
      keep += 1
      if (L < 100) darkKeep += 1
      if (L >= studioLuma - 4 && c <= 24) paleKeep += 1
    } else if (L >= studioLuma - 4 && c <= 24) {
      paleRemove += 1
    }
  }
  console.log(label, {
    keep,
    paleKeep,
    paleRemove,
    darkKeep,
    keepRatio: +(keep / mask.data.length).toFixed(3),
  })
}

const seed = segmentGarmentBySeeds(imageData)
stats('after seeds', seed.mask)

const full = await runAutoMaskPipeline(imageData, 'auto')
stats('after full pipeline', full.mask)

// Sample interior pale REMOVE after full
const samples = []
for (let y = 80; y < 200; y += 8) {
  for (let x = 80; x < 220; x += 8) {
    const i = y * full.mask.width + x
    if (full.mask.data[i]! >= 128) continue
    const o = i * 4
    const r = imageData.data[o]!
    const g = imageData.data[o + 1]!
    const b = imageData.data[o + 2]!
    const L = 0.299 * r + 0.587 * g + 0.114 * b
    const c = Math.max(r, g, b) - Math.min(r, g, b)
    if (L < studioLuma - 2 || c > 22) continue
    samples.push({
      x,
      y,
      L: +L.toFixed(1),
      above: +(L - studioLuma).toFixed(1),
      v: +localLumaVariance(imageData, x, y, 1).toFixed(1),
      m: full.mask.data[i]!,
    })
  }
}
console.log('interior pale REMOVE samples', samples.length)
console.log(samples.slice(0, 15))
