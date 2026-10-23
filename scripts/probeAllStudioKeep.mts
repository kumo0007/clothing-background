import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
import { averageCornerColor } from '../src/lib/mask/selectSimilar'
import {
  buildIndependentReferenceMask,
} from '../src/lib/mask/audit/referenceMask'
import { computeBinaryMetrics } from '../src/lib/mask/audit/metrics'

const files = [
  '01_hoodie.jpg',
  '02_blazer.jpg',
  '04_jeans.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
  '05_coat.jpg',
]

for (const f of files) {
  const d = jpeg.decode(readFileSync(`public/testdata/clothing/${f}`), {
    useTArray: true,
    formatAsRGBA: true,
  })
  const img = {
    width: d.width,
    height: d.height,
    data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
    colorSpace: 'srgb',
  } as ImageData
  const r = await runAutoMaskPipeline(img, 'auto')
  const corner = averageCornerColor(img)
  const studioL = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  let studioKeep = 0
  let keep = 0
  for (let i = 0; i < r.mask.data.length; i++) {
    if (r.mask.data[i]! < 128) continue
    keep++
    const o = i * 4
    const R = img.data[o]!
    const G = img.data[o + 1]!
    const B = img.data[o + 2]!
    const L = 0.299 * R + 0.587 * G + 0.114 * B
    const dist = Math.hypot(R - corner.r, G - corner.g, B - corner.b)
    if (L >= studioL - 5 && L <= studioL + 12 && dist <= 40) studioKeep++
  }
  const ref = buildIndependentReferenceMask(img)
  const m = computeBinaryMetrics(r.mask, ref)
  console.log(
    JSON.stringify({
      f,
      keep,
      studioKeep,
      studioKeepPct: +((100 * studioKeep) / keep).toFixed(1),
      iou: m.definiteIoU,
      conf: r.confidence,
    }),
  )
}
