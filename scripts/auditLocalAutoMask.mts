/**
 * Local Lab-seed quality smoke on clothing fixtures (library/audit path).
 * UI Batch auto-mask uses bg-remove-sdk; this script still exercises Lab-seed.
 * No network / Poof / ISNet.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { segmentImageLocally } from '../src/lib/mask/localSegment.ts'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'tmp-local-automask-audit')
mkdirSync(outDir, { recursive: true })

function decode(path: string) {
  const buf = readFileSync(path)
  if (path.toLowerCase().endsWith('.png')) {
    const png = PNG.sync.read(buf)
    return {
      width: png.width,
      height: png.height,
      data: new Uint8ClampedArray(png.data),
      colorSpace: 'srgb' as const,
    } as ImageData
  }
  const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
    colorSpace: 'srgb' as const,
  } as ImageData
}

function countKeep(mask: { data: Uint8ClampedArray }) {
  let n = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! >= 128) n += 1
  }
  return n
}

function countSoft(mask: { data: Uint8ClampedArray }) {
  let n = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    const v = mask.data[i]!
    if (v > 0 && v < 255) n += 1
  }
  return n
}

function borderKeepRate(mask: {
  data: Uint8ClampedArray
  width: number
  height: number
}) {
  const { width: w, height: h, data } = mask
  let border = 0
  let keep = 0
  for (let x = 0; x < w; x += 1) {
    border += 2
    if (data[x]! >= 128) keep += 1
    if (data[(h - 1) * w + x]! >= 128) keep += 1
  }
  for (let y = 1; y < h - 1; y += 1) {
    border += 2
    if (data[y * w]! >= 128) keep += 1
    if (data[y * w + (w - 1)]! >= 128) keep += 1
  }
  return border === 0 ? 0 : keep / border
}

const fixtures = [
  'public/testdata/clothing/01_hoodie.jpg',
  'public/testdata/clothing/02_blazer.jpg',
  'public/testdata/clothing/03_tshirt.jpg',
  'public/testdata/clothing/04_jeans.jpg',
  'public/testdata/clothing/05_coat.jpg',
  'public/testdata/clothing/10_cap.jpg',
  'public/testdata/clothing/08_sneakers.jpg',
  'public/testdata/clothing/09_handbag.jpg',
  'public/testdata/clothing/06_sweater.jpg',
  'public/testdata/clothing/07_dress.jpg',
]

const rows: string[] = [
  '# Local Lab-seed auto-mask audit',
  '',
  'Path: `segmentImageLocally` → `runLabSeedAutoMask` (no Poof / ISNet / GrabCut).',
  '',
  '| Fixture | Method | Size | KEEP% | soft% | borderKEEP% | needsReview | ms |',
  '|---|---|---|---|---|---|---|---|',
]

let fetchCalls = 0
const originalFetch = globalThis.fetch
globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
  fetchCalls += 1
  return originalFetch(...args)
}) as typeof fetch

for (const rel of fixtures) {
  const abs = resolve(root, rel)
  if (!existsSync(abs)) {
    rows.push(`| ${basename(rel)} | MISSING | — | — | — | — | — | — |`)
    continue
  }
  const image = decode(abs)
  const rgbBefore = image.data.slice(0, 64)
  const t0 = Date.now()
  const result = await segmentImageLocally(image, { tolerance: 40 })
  const ms = Date.now() - t0
  const rgbIntact = rgbBefore.every((v, i) => v === image.data[i])
  if (!rgbIntact) {
    throw new Error(`Source RGB mutated for ${rel}`)
  }
  if (result.methodUsed !== 'opencv-seed-fallback') {
    throw new Error(`Unexpected method ${result.methodUsed} for ${rel}`)
  }
  if (result.genuineModelInference !== false) {
    throw new Error(`Expected genuineModelInference=false for ${rel}`)
  }
  const keep = countKeep(result.mask)
  const soft = countSoft(result.mask)
  const total = result.mask.data.length
  const border = borderKeepRate(result.mask)
  rows.push(
    `| ${basename(rel)} | ${result.methodUsed} | ${result.mask.width}×${result.mask.height} | ${((100 * keep) / total).toFixed(1)} | ${((100 * soft) / total).toFixed(2)} | ${(100 * border).toFixed(1)} | ${result.needsReview} | ${ms} |`,
  )

  // Write grayscale mask PNG for visual inspection.
  const png = new PNG({ width: result.mask.width, height: result.mask.height })
  for (let i = 0; i < result.mask.data.length; i += 1) {
    const v = result.mask.data[i]!
    const o = i * 4
    png.data[o] = v
    png.data[o + 1] = v
    png.data[o + 2] = v
    png.data[o + 3] = 255
  }
  writeFileSync(
    resolve(outDir, `${basename(rel, '.jpg')}-mask.png`),
    PNG.sync.write(png),
  )
}

if (fetchCalls > 0) {
  throw new Error(`Unexpected fetch calls during local audit: ${fetchCalls}`)
}

rows.push('')
rows.push(`Fetch calls during audit: **${fetchCalls}** (must be 0).`)
rows.push('')
rows.push('## Notes')
rows.push('')
rows.push('- High `borderKEEP%` or extreme KEEP% often warrants manual review.')
rows.push('- White-on-white (tee, sneakers) and openings (handbag) are classical-CV hard cases.')
rows.push('- Soft% > 0 shows partial alpha along edges was preserved (not binary-thresholded away).')
rows.push('')

const report = rows.join('\n')
writeFileSync(resolve(outDir, 'REPORT.md'), report)
console.log(report)
console.log(`\nWrote ${outDir}`)
