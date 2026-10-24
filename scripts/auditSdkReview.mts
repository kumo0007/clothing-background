/**
 * @deprecated Prefer `auditMaskDiagnostics.mts` (JSON + structured ruleIds).
 * Audit neural review policy against Lab-seed silhouettes (proxy).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import jpeg from 'jpeg-js'
import { segmentImageLocally } from '../src/lib/mask/localSegment.ts'
import { estimateMaskConfidence } from '../src/lib/mask/maskConfidence.ts'
import { reviewSdkMask } from '../src/lib/mask/sdkMaskReview.ts'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'tmp-sdk-review-audit')
mkdirSync(outDir, { recursive: true })

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

const rows: string[] = [
  '# SDK neural review audit (Lab-seed silhouette proxy)',
  '',
  '| Fixture | classical review | neural review | sdkReview | reasons |',
  '|---|---|---|---|---|',
]

for (const name of fixtures) {
  const abs = resolve(root, 'public/testdata/clothing', name)
  if (!existsSync(abs)) continue
  const image = decode(abs)
  const seg = await segmentImageLocally(image, { tolerance: 40 })
  const classical = estimateMaskConfidence(seg.mask, image, {
    profile: 'classical',
  })
  const neural = estimateMaskConfidence(seg.mask, image, { profile: 'neural' })
  const maskCopy = {
    width: seg.mask.width,
    height: seg.mask.height,
    data: new Uint8ClampedArray(seg.mask.data),
  }
  const sdk = reviewSdkMask(maskCopy, image, { resized: false })
  rows.push(
    `| ${basename(name)} | ${classical.needsReview} | ${neural.needsReview} | ${sdk.needsReview} | ${(sdk.reasons[0] ?? '—').slice(0, 80)} |`,
  )
}

const report = rows.join('\n')
writeFileSync(resolve(outDir, 'REPORT.md'), report)
console.log(report)
