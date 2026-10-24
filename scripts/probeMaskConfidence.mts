/**
 * Quick probe: which clothing fixtures trip estimateMaskConfidence review,
 * and with which reasons (using Lab-seed masks as a stand-in silhouette).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import jpeg from 'jpeg-js'
import { segmentImageLocally } from '../src/lib/mask/localSegment.ts'
import { estimateMaskConfidence } from '../src/lib/mask/maskConfidence.ts'

const root = resolve(import.meta.dirname, '..')
const fixtures = [
  '01_hoodie.jpg',
  '02_blazer.jpg',
  '03_tshirt.jpg',
  '04_jeans.jpg',
  '05_coat.jpg',
  '06_sweater.jpg',
  '07_dress.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
  '10_cap.jpg',
]

function decode(path: string) {
  const buf = readFileSync(path)
  const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
    colorSpace: 'srgb' as const,
  } as ImageData
}

for (const name of fixtures) {
  const abs = resolve(root, 'public/testdata/clothing', name)
  if (!existsSync(abs)) {
    console.log(name, 'MISSING')
    continue
  }
  const image = decode(abs)
  const seg = await segmentImageLocally(image, { tolerance: 40 })
  const conf = estimateMaskConfidence(seg.mask, image)
  console.log(
    basename(name),
    'score=',
    conf.score.toFixed(2),
    'review=',
    conf.needsReview,
    'reasons=',
    conf.reasons.join(' | ') || '(none)',
  )
}
