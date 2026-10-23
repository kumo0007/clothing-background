/**
 * Evidence-driven comparison: Lab-seed (current default) vs local ISNet ONNX.
 *
 * - Explicit methodUsed / genuineModelInference (no silent fallback confusion)
 * - Side-by-side: source, mask, transparent, beige replacement
 * - Definite-label metrics vs existing appearance+border references
 *
 * Run: npx vite-node scripts/compareLabVsIsnet.mts
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import {
  runAutoMaskPipeline,
  runIsnetAutoMask,
} from '../src/lib/mask/autoMaskPipeline'
import {
  buildIndependentReferenceMask,
  summarizeReferenceCoverage,
} from '../src/lib/mask/audit/referenceMask'
import {
  computeBinaryMetrics,
  computeBoundaryMetrics,
  computeInternalHoleError,
} from '../src/lib/mask/audit/metrics'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const outDir = join(root, 'tmp-model-compare')

const FIXTURES = [
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
] as const

const MAGENTA: [number, number, number] = [255, 0, 255]
const BEIGE: [number, number, number] = [217, 196, 174]

function decodeJpeg(path: string): ImageData {
  const raw = readFileSync(path)
  const decoded = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength,
    ),
    colorSpace: 'srgb',
  } as ImageData
}

function writePng(
  path: string,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
) {
  const png = new PNG({ width, height })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  writeFileSync(path, PNG.sync.write(png))
}

function fillBg(n: number, rgb: [number, number, number]) {
  const b = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i += 1) {
    const o = i * 4
    b[o] = rgb[0]
    b[o + 1] = rgb[1]
    b[o + 2] = rgb[2]
    b[o + 3] = 255
  }
  return b
}

function transparentComposite(
  src: Uint8ClampedArray,
  mask: Uint8ClampedArray,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < mask.length; i += 1) {
    const o = i * 4
    const a = mask[i]! / 255
    out[o] = src[o]!
    out[o + 1] = src[o + 1]!
    out[o + 2] = src[o + 2]!
    out[o + 3] = Math.round(255 * a)
  }
  return out
}

function maskRgba(mask: Uint8ClampedArray, n: number) {
  const rgba = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i += 1) {
    const v = mask[i]!
    const o = i * 4
    rgba[o] = v
    rgba[o + 1] = v
    rgba[o + 2] = v
    rgba[o + 3] = 255
  }
  return rgba
}

function fingerprint(imageData: ImageData): string {
  const pts = [
    [0, 0],
    [imageData.width - 1, 0],
    [(imageData.width / 2) | 0, (imageData.height / 2) | 0],
  ] as const
  return pts
    .map(([x, y]) => {
      const o = (y * imageData.width + x) * 4
      return `${imageData.data[o]},${imageData.data[o + 1]},${imageData.data[o + 2]}`
    })
    .join('|')
}

function ensureDirs(...paths: string[]) {
  for (const p of paths) mkdirSync(p, { recursive: true })
}

type Row = Record<string, unknown>

ensureDirs(
  outDir,
  join(outDir, 'lab-seed'),
  join(outDir, 'isnet'),
  join(outDir, 'lab-seed', 'masks'),
  join(outDir, 'lab-seed', 'magenta'),
  join(outDir, 'lab-seed', 'beige'),
  join(outDir, 'lab-seed', 'transparent'),
  join(outDir, 'lab-seed', 'source'),
  join(outDir, 'isnet', 'masks'),
  join(outDir, 'isnet', 'magenta'),
  join(outDir, 'isnet', 'beige'),
  join(outDir, 'isnet', 'transparent'),
  join(outDir, 'isnet', 'source'),
)

const labRows: Row[] = []
const isnetRows: Row[] = []
let isnetError: string | null = null

console.log('=== Lab-seed (current default) ===')
for (const name of FIXTURES) {
  const srcPath = join(clothingDir, name)
  const imageData = decodeJpeg(srcPath)
  const before = fingerprint(imageData)
  const result = await runAutoMaskPipeline(imageData, 'auto')
  const after = fingerprint(imageData)
  const n = imageData.width * imageData.height
  const ref = buildIndependentReferenceMask(imageData)
  const binary = computeBinaryMetrics(result.mask, ref)
  const boundary = computeBoundaryMetrics(result.mask, ref, 2)
  const holes = computeInternalHoleError(result.mask, ref, imageData)
  const coverage = summarizeReferenceCoverage(ref)
  const base = name.replace(/\.jpg$/i, '')

  copyFileSync(srcPath, join(outDir, 'lab-seed', 'source', name))
  writePng(
    join(outDir, 'lab-seed', 'masks', `${base}-mask.png`),
    imageData.width,
    imageData.height,
    maskRgba(result.mask.data, n),
  )
  writePng(
    join(outDir, 'lab-seed', 'magenta', `${base}-result.png`),
    imageData.width,
    imageData.height,
    compositePixelBuffers(imageData.data, result.mask.data, fillBg(n, MAGENTA)),
  )
  writePng(
    join(outDir, 'lab-seed', 'beige', `${base}-result.png`),
    imageData.width,
    imageData.height,
    compositePixelBuffers(imageData.data, result.mask.data, fillBg(n, BEIGE)),
  )
  writePng(
    join(outDir, 'lab-seed', 'transparent', `${base}-result.png`),
    imageData.width,
    imageData.height,
    transparentComposite(imageData.data, result.mask.data),
  )

  const row = {
    file: name,
    methodUsed: result.methodUsed,
    genuineModelInference: result.genuineModelInference === true,
    elapsedMs: result.elapsedMs,
    sourceRgbUnchanged: before === after,
    reference: coverage,
    binary,
    boundary,
    holes,
  }
  labRows.push(row)
  console.log(
    `${name}: ${result.methodUsed} genuine=${row.genuineModelInference} ${result.elapsedMs}ms iou=${binary.iou.toFixed(4)} holes=${holes.internalHoleErrorPixels}`,
  )
}

console.log('\n=== ISNet ONNX (@imgly/background-removal-node) ===')
try {
  for (const name of FIXTURES) {
    const srcPath = join(clothingDir, name)
    const imageData = decodeJpeg(srcPath)
    const before = fingerprint(imageData)
    const result = await runIsnetAutoMask(imageData, 40, 'medium', srcPath)
    const after = fingerprint(imageData)
    const n = imageData.width * imageData.height
    const ref = buildIndependentReferenceMask(imageData)
    const binary = computeBinaryMetrics(result.mask, ref)
    const boundary = computeBoundaryMetrics(result.mask, ref, 2)
    const holes = computeInternalHoleError(result.mask, ref, imageData)
    const coverage = summarizeReferenceCoverage(ref)
    const base = name.replace(/\.jpg$/i, '')

    copyFileSync(srcPath, join(outDir, 'isnet', 'source', name))
    writePng(
      join(outDir, 'isnet', 'masks', `${base}-mask.png`),
      imageData.width,
      imageData.height,
      maskRgba(result.mask.data, n),
    )
    writePng(
      join(outDir, 'isnet', 'magenta', `${base}-result.png`),
      imageData.width,
      imageData.height,
      compositePixelBuffers(
        imageData.data,
        result.mask.data,
        fillBg(n, MAGENTA),
      ),
    )
    writePng(
      join(outDir, 'isnet', 'beige', `${base}-result.png`),
      imageData.width,
      imageData.height,
      compositePixelBuffers(imageData.data, result.mask.data, fillBg(n, BEIGE)),
    )
    writePng(
      join(outDir, 'isnet', 'transparent', `${base}-result.png`),
      imageData.width,
      imageData.height,
      transparentComposite(imageData.data, result.mask.data),
    )

    const row = {
      file: name,
      methodUsed: result.methodUsed,
      genuineModelInference: result.genuineModelInference === true,
      elapsedMs: result.elapsedMs,
      sourceRgbUnchanged: before === after,
      reference: coverage,
      binary,
      boundary,
      holes,
    }
    isnetRows.push(row)
    console.log(
      `${name}: ${result.methodUsed} genuine=${row.genuineModelInference} ${result.elapsedMs}ms iou=${binary.iou.toFixed(4)} holes=${holes.internalHoleErrorPixels}`,
    )
  }
} catch (err) {
  isnetError = err instanceof Error ? err.message : String(err)
  console.error('ISNet path FAILED (not substituted with Lab-seed):', isnetError)
}

const comparison = FIXTURES.map((name) => {
  const lab = labRows.find((r) => r.file === name) as
    | {
        binary: { iou: number; fgRecall: number; fgPrecision: number }
        holes: { internalHoleErrorPixels: number }
        elapsedMs: number
        methodUsed: string
      }
    | undefined
  const isn = isnetRows.find((r) => r.file === name) as
    | {
        binary: { iou: number; fgRecall: number; fgPrecision: number }
        holes: { internalHoleErrorPixels: number }
        elapsedMs: number
        methodUsed: string
      }
    | undefined
  return {
    file: name,
    labSeed: lab
      ? {
          methodUsed: lab.methodUsed,
          iou: lab.binary.iou,
          fgRecall: lab.binary.fgRecall,
          fgPrecision: lab.binary.fgPrecision,
          holes: lab.holes.internalHoleErrorPixels,
          elapsedMs: lab.elapsedMs,
        }
      : null,
    isnet: isn
      ? {
          methodUsed: isn.methodUsed,
          iou: isn.binary.iou,
          fgRecall: isn.binary.fgRecall,
          fgPrecision: isn.binary.fgPrecision,
          holes: isn.holes.internalHoleErrorPixels,
          elapsedMs: isn.elapsedMs,
        }
      : null,
    deltaIou:
      lab && isn ? Number((isn.binary.iou - lab.binary.iou).toFixed(4)) : null,
  }
})

const summary = {
  generatedAt: new Date().toISOString(),
  labSeedDefault: true,
  isnetOptIn: true,
  isnetError,
  licenseNote:
    '@imgly/background-removal* is AGPL-3.0; commercial use may require IMG.LY paid license. Weights downloaded from IMG.LY CDN on first run.',
  referencePolicy:
    'Appearance+border derived references — not manual GT. Uncertain excluded from binary IoU.',
  comparison,
  labFixtures: labRows,
  isnetFixtures: isnetRows,
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(`\nWrote ${outDir}`)
