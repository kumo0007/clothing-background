/**
 * Fresh exports for the six client hard cases + full clothing set.
 * Magenta QA + beige replacement + mask. Lab-seed auto path (no WASM hang).
 *
 * Run: npx vite-node scripts/exportProductionPass.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
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
const outDir = join(root, 'tmp-production-pass')

const FIXTURES = [
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

mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, 'magenta'), { recursive: true })
mkdirSync(join(outDir, 'beige'), { recursive: true })
mkdirSync(join(outDir, 'masks'), { recursive: true })

const reports = []

for (const name of FIXTURES) {
  const imageData = decodeJpeg(join(clothingDir, name))
  const before = fingerprint(imageData)
  const result = await runAutoMaskPipeline(imageData, 'auto')
  const after = fingerprint(imageData)
  const n = imageData.width * imageData.height
  const ref = buildIndependentReferenceMask(imageData)
  const binary = computeBinaryMetrics(result.mask, ref)
  const boundary = computeBoundaryMetrics(result.mask, ref, 2)
  const holes = computeInternalHoleError(result.mask, ref, imageData)
  const coverage = summarizeReferenceCoverage(ref)

  const magenta = compositePixelBuffers(
    imageData.data,
    result.mask.data,
    fillBg(n, MAGENTA),
  )
  const beige = compositePixelBuffers(
    imageData.data,
    result.mask.data,
    fillBg(n, BEIGE),
  )
  const base = name.replace(/\.jpg$/i, '')
  writePng(join(outDir, 'magenta', `${base}-result.png`), imageData.width, imageData.height, magenta)
  writePng(join(outDir, 'beige', `${base}-result.png`), imageData.width, imageData.height, beige)
  writePng(
    join(outDir, 'masks', `${base}-mask.png`),
    imageData.width,
    imageData.height,
    maskRgba(result.mask.data, n),
  )

  // Also refresh quality-pass magenta for continuity
  writePng(
    join(root, 'tmp-quality-pass-exports', `${base}-result.png`),
    imageData.width,
    imageData.height,
    magenta,
  )

  const row = {
    file: name,
    methodUsed: result.methodUsed,
    elapsedMs: result.elapsedMs,
    sourceRgbUnchanged: before === after,
    reference: coverage,
    binary,
    boundary,
    holes,
  }
  reports.push(row)
  console.log(
    `${name}: ${result.methodUsed} ${result.elapsedMs}ms iou=${binary.iou} holes=${holes.internalHoleErrorPixels}`,
  )
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), fixtures: reports }, null, 2))
console.log(`Wrote ${outDir}`)
