/**
 * Lab-seed vs Contour-first side-by-side for all 10 clothing fixtures.
 * Run: npx vite-node scripts/compareContourFirst.mts
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
import { segmentGarmentContourFirst } from '../src/lib/mask/contourFirst/contourFirstSegment'
import {
  buildIndependentReferenceMask,
  summarizeReferenceCoverage,
} from '../src/lib/mask/audit/referenceMask'
import {
  computeBinaryMetrics,
  computeBoundaryMetrics,
} from '../src/lib/mask/audit/metrics'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const outDir = join(root, 'tmp-contour-first')

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

function grayRgba(gray: Uint8ClampedArray, w: number, h: number) {
  return maskRgba(gray, w * h)
}

function nearWhitePct(
  rgba: Uint8ClampedArray,
  n: number,
  beige: [number, number, number],
): number {
  let nearWhite = 0
  for (let i = 0; i < n; i += 1) {
    const o = i * 4
    const r = rgba[o]!
    const g = rgba[o + 1]!
    const b = rgba[o + 2]!
    const L = 0.299 * r + 0.587 * g + 0.114 * b
    const dBeige = Math.hypot(r - beige[0], g - beige[1], b - beige[2])
    if (dBeige >= 18 && L > 210 && Math.max(r, g, b) - Math.min(r, g, b) < 25) {
      nearWhite += 1
    }
  }
  return (100 * nearWhite) / n
}

for (const method of ['lab-seed', 'contour-first'] as const) {
  for (const sub of [
    'source',
    'edges',
    'masks',
    'magenta',
    'beige',
    'contour-overlay',
  ]) {
    mkdirSync(join(outDir, method, sub), { recursive: true })
  }
}

const summary: unknown[] = []

for (const name of FIXTURES) {
  const srcPath = join(clothingDir, name)
  const imageData = decodeJpeg(srcPath)
  const base = name.replace(/\.jpg$/i, '')
  const n = imageData.width * imageData.height
  const ref = buildIndependentReferenceMask(imageData)
  const coverage = summarizeReferenceCoverage(ref)

  copyFileSync(srcPath, join(outDir, 'lab-seed', 'source', name))
  copyFileSync(srcPath, join(outDir, 'contour-first', 'source', name))

  const before = imageData.data.slice(0, 12)
  const lab = await runAutoMaskPipeline(imageData, 'auto')
  const afterLab = imageData.data.slice(0, 12)
  const labRgbOk = before.every((v, i) => v === afterLab[i])

  const cf = segmentGarmentContourFirst(imageData, { includeDebug: true })
  const afterCf = imageData.data.slice(0, 12)
  const cfRgbOk = before.every((v, i) => v === afterCf[i])

  const labBin = computeBinaryMetrics(lab.mask, ref)
  const cfBin = computeBinaryMetrics(cf.mask, ref)
  const labBound = computeBoundaryMetrics(lab.mask, ref, 2)
  const cfBound = computeBoundaryMetrics(cf.mask, ref, 2)

  for (const [method, mask, extras] of [
    ['lab-seed', lab.mask, null],
    ['contour-first', cf.mask, cf.debug],
  ] as const) {
    const magenta = compositePixelBuffers(
      imageData.data,
      mask.data,
      fillBg(n, MAGENTA),
    )
    const beige = compositePixelBuffers(
      imageData.data,
      mask.data,
      fillBg(n, BEIGE),
    )
    writePng(
      join(outDir, method, 'masks', `${base}-mask.png`),
      imageData.width,
      imageData.height,
      maskRgba(mask.data, n),
    )
    writePng(
      join(outDir, method, 'magenta', `${base}-magenta.png`),
      imageData.width,
      imageData.height,
      magenta,
    )
    writePng(
      join(outDir, method, 'beige', `${base}-beige.png`),
      imageData.width,
      imageData.height,
      beige,
    )
    if (extras?.edges) {
      writePng(
        join(outDir, method, 'edges', `${base}-edges.png`),
        imageData.width,
        imageData.height,
        grayRgba(extras.edges, imageData.width, imageData.height),
      )
    }
  }

  const labBeige = compositePixelBuffers(
    imageData.data,
    lab.mask.data,
    fillBg(n, BEIGE),
  )
  const cfBeige = compositePixelBuffers(
    imageData.data,
    cf.mask.data,
    fillBg(n, BEIGE),
  )

  const row = {
    fixture: base,
    lab: {
      methodUsed: lab.methodUsed,
      iou: labBin.iou,
      boundaryF1: labBound.boundaryF1,
      confidence: lab.confidence,
      needsReview: lab.needsReview,
      nearWhitePct: +nearWhitePct(labBeige, n, BEIGE).toFixed(2),
      sourceRgbUnchanged: labRgbOk,
    },
    contour: {
      methodUsed: cf.methodUsed,
      iou: cfBin.iou,
      boundaryF1: cfBound.boundaryF1,
      confidence: cf.confidence,
      needsReview: cf.needsReview,
      nearWhitePct: +nearWhitePct(cfBeige, n, BEIGE).toFixed(2),
      sourceRgbUnchanged: cfRgbOk,
      accepted: cf.diagnostics.contourAccepted,
      rejectReason: cf.diagnostics.rejectReason,
      stages: cf.diagnostics.stages,
      seedAgreement: +cf.diagnostics.seedAgreement.toFixed(3),
      areaRatio: +cf.diagnostics.outerAreaRatio.toFixed(3),
    },
    refCoverage: coverage,
  }
  summary.push(row)
  console.log(JSON.stringify(row))
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(`Wrote ${outDir}`)
