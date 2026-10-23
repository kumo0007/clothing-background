import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { segmentGarmentBySeeds } from '../src/lib/mask/opencv/segmentSeeds'
import { createMaskBuffer } from '../src/lib/mask/createMask'
import { fillMaskHoles } from '../src/lib/mask/refineMask'
import {
  applyPaleCompetition,
  markCompetitionProtectedPale,
} from '../src/lib/mask/paleCompetition'
import {
  averageCornerColor,
  stripEnclosedFlatStudio,
  stripBorderConnectedStudio,
} from '../src/lib/mask/selectSimilar'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'

const raw = readFileSync('public/testdata/clothing/08_sneakers.jpg')
const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
const imageData = {
  width: d.width,
  height: d.height,
  data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
  colorSpace: 'srgb',
} as ImageData
const corner = averageCornerColor(imageData)
const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b

function paleKeep(mask: { data: Uint8ClampedArray }) {
  let n = 0
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i]! < 128) continue
    const o = i * 4
    const L =
      0.299 * imageData.data[o]! +
      0.587 * imageData.data[o + 1]! +
      0.114 * imageData.data[o + 2]!
    const c =
      Math.max(imageData.data[o]!, imageData.data[o + 1]!, imageData.data[o + 2]!) -
      Math.min(imageData.data[o]!, imageData.data[o + 1]!, imageData.data[o + 2]!)
    if (L >= studioLuma - 4 && c <= 24) n++
  }
  return n
}

const seed = segmentGarmentBySeeds(imageData)
console.log('after seeds (includes competition)', paleKeep(seed.mask), 'keep', [...seed.mask.data].filter((v) => v >= 128).length)

// Gate diagnostics on seed mask
{
  const mask = seed.mask
  const w = d.width
  const h = d.height
  let darkKeep = 0
  let warmKeep = 0
  let keepCount = 0
  let paleKeepN = 0
  let paleKeepTouchingDark = 0
  let darkish = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (mask.data[i]! < 128) continue
      keepCount++
      const o = i * 4
      const r = imageData.data[o]!
      const g = imageData.data[o + 1]!
      const b = imageData.data[o + 2]!
      const L = 0.299 * r + 0.587 * g + 0.114 * b
      const c = Math.max(r, g, b) - Math.min(r, g, b)
      if (L < 100) darkKeep++
      if (L < 120) darkish++
      if (r > b + 12 && c >= 16 && L >= 130 && L <= 220) warmKeep++
      const pale = L >= 165 && c <= 30 && L <= studioLuma + 28
      if (pale) {
        paleKeepN++
        for (const n of [i - 1, i + 1, i - w, i + w]) {
          if (n < 0 || n >= mask.data.length || mask.data[n]! < 128) continue
          const no = n * 4
          const nL =
            0.299 * imageData.data[no]! +
            0.587 * imageData.data[no + 1]! +
            0.114 * imageData.data[no + 2]!
          if (nL < 100) {
            paleKeepTouchingDark++
            break
          }
        }
      }
    }
  }
  console.log({
    darkKeep,
    darkish,
    warmKeep,
    keepCount,
    paleKeepN,
    paleKeepShare: paleKeepN / keepCount,
    paleKeepTouchingDark,
    minDark: Math.max(80, Math.floor(w * h * 0.012)),
    minPaleTouch: Math.max(16, Math.floor(w * h * 0.002)),
  })
}

const mask = createMaskBuffer(d.width, d.height, 0)
// Raw seeds without re-running competition: call segment internals via copy then strip
mask.data.set(seed.mask.data)
fillMaskHoles(mask)
const c1 = applyPaleCompetition(mask, imageData)
console.log('competition after fill', c1, 'pale', paleKeep(mask))
const prot = markCompetitionProtectedPale(mask, imageData)
console.log('protected', [...prot].filter((v) => v).length)
stripEnclosedFlatStudio(mask, imageData, 40)
console.log('after enclosed', paleKeep(mask))
stripBorderConnectedStudio(mask, imageData, 40)
console.log('after border', paleKeep(mask))

const full = await runAutoMaskPipeline(imageData, 'auto', 40)
console.log('full pipeline pale', paleKeep(full.mask), 'keep', [...full.mask.data].filter((v) => v >= 128).length)
console.log('confidence', full.confidence, 'needsReview', full.needsReview)
