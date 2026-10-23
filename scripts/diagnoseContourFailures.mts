/**
 * Full 10-fixture diagnostics: source, mask, overlay, magenta, beige, edge crop.
 * Run: npx vite-node scripts/diagnoseContourFailures.mts
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
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
const outDir = join(root, 'tmp-contour-diagnose')

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
  const decoded = jpeg.decode(readFileSync(path), {
    useTArray: true,
    formatAsRGBA: true,
  })
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

function overlayRgba(
  image: ImageData,
  mask: Uint8ClampedArray,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(image.data.length)
  for (let i = 0; i < mask.length; i += 1) {
    const o = i * 4
    const a = mask[i]! / 255
    out[o] = Math.round(image.data[o]! * (1 - 0.45 * a) + 255 * 0.45 * a)
    out[o + 1] = Math.round(image.data[o + 1]! * (1 - 0.45 * a))
    out[o + 2] = Math.round(image.data[o + 2]! * (1 - 0.45 * a))
    out[o + 3] = 255
  }
  return out
}

function edgeCrop(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8ClampedArray,
): { width: number; height: number; data: Uint8ClampedArray } {
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]! < 128) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX) {
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) }
  }
  const pad = 24
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(width - 1, maxX + pad)
  maxY = Math.min(height - 1, maxY + pad)
  const cw = maxX - minX + 1
  const ch = maxY - minY + 1
  const data = new Uint8ClampedArray(cw * ch * 4)
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const si = ((minY + y) * width + (minX + x)) * 4
      const di = (y * cw + x) * 4
      data[di] = rgba[si]!
      data[di + 1] = rgba[si + 1]!
      data[di + 2] = rgba[si + 2]!
      data[di + 3] = 255
    }
  }
  return { width: cw, height: ch, data }
}

function borderKeepPct(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  band = 6,
): number {
  let keep = 0
  let n = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        x >= band &&
        y >= band &&
        x < width - band &&
        y < height - band
      ) {
        continue
      }
      n += 1
      if (mask[y * width + x]! > 127) keep += 1
    }
  }
  return n === 0 ? 0 : (100 * keep) / n
}

for (const sub of [
  'source',
  'masks',
  'overlay',
  'magenta',
  'beige',
  'transparent',
  'edge',
]) {
  mkdirSync(join(outDir, sub), { recursive: true })
}

const summary = []

for (const name of FIXTURES) {
  const srcPath = join(clothingDir, name)
  const imageData = decodeJpeg(srcPath)
  const base = name.replace(/\.jpg$/i, '')
  copyFileSync(srcPath, join(outDir, 'source', name))

  const before = imageData.data.slice(0, 16)
  const result = await runAutoMaskPipeline(imageData, 'auto')
  const after = imageData.data.slice(0, 16)
  const rgbUnchanged = before.every((v, i) => v === after[i])

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
  const transparent = compositePixelBuffers(
    imageData.data,
    result.mask.data,
    fillBg(n, BEIGE),
    { transparentBackground: true },
  )
  const overlay = overlayRgba(imageData, result.mask.data)
  const crop = edgeCrop(magenta, imageData.width, imageData.height, result.mask.data)

  writePng(
    join(outDir, 'masks', `${base}-mask.png`),
    imageData.width,
    imageData.height,
    maskRgba(result.mask.data, n),
  )
  writePng(
    join(outDir, 'overlay', `${base}-overlay.png`),
    imageData.width,
    imageData.height,
    overlay,
  )
  writePng(
    join(outDir, 'magenta', `${base}-magenta.png`),
    imageData.width,
    imageData.height,
    magenta,
  )
  writePng(
    join(outDir, 'beige', `${base}-beige.png`),
    imageData.width,
    imageData.height,
    beige,
  )
  writePng(
    join(outDir, 'transparent', `${base}-transparent.png`),
    imageData.width,
    imageData.height,
    transparent,
  )
  writePng(
    join(outDir, 'edge', `${base}-edge.png`),
    crop.width,
    crop.height,
    crop.data,
  )

  const row = {
    fixture: base,
    methodUsed: result.methodUsed,
    elapsedMs: result.elapsedMs,
    confidence: result.confidence,
    needsReview: result.needsReview,
    sourceRgbUnchanged: rgbUnchanged,
    borderKeepPct: +borderKeepPct(
      result.mask.data,
      imageData.width,
      imageData.height,
    ).toFixed(2),
    definiteIoU: binary.iou,
    boundaryF1: boundary.boundaryF1,
    holeProxy: holes.falseInteriorHoles,
    refCoverage: coverage,
  }
  summary.push(row)
  console.log(JSON.stringify(row))
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(`Wrote ${outDir}`)
