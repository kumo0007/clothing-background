/**
 * Verify strengthened contour validation + strategy selection outputs.
 *
 * Run: npx vite-node scripts/verifyContourValidation.mts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import {
  runAutoMaskPipeline,
  type AutoMaskMethod,
} from '../src/lib/mask/autoMaskPipeline'
import { segmentGarmentContourFirst } from '../src/lib/mask/contourFirst/contourFirstSegment'
import {
  clearAllMasks,
  getMask,
  getOrCreateMask,
  setMask,
} from '../src/lib/mask/maskStore'
import type { MaskPixelBuffer } from '../src/types/mask'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const outDir = join(root, 'tmp-contour-validation')

const FIXTURES = [
  { name: '03_tshirt.jpg', role: 'white-tee' },
  { name: '08_sneakers.jpg', role: 'sneakers' },
  { name: '02_blazer.jpg', role: 'dark-garment' },
  { name: '04_jeans.jpg', role: 'dark-garment-regression' },
] as const

const BEIGE: [number, number, number] = [217, 196, 174]
const STRATEGIES: AutoMaskMethod[] = ['auto', 'contour']

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

function checksum(mask: MaskPixelBuffer): string {
  return createHash('sha256')
    .update(Buffer.from(mask.data))
    .digest('hex')
    .slice(0, 16)
}

function counts(mask: MaskPixelBuffer) {
  let fg = 0
  let bg = 0
  let soft = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    const v = mask.data[i]!
    if (v >= 250) fg += 1
    else if (v <= 5) bg += 1
    else soft += 1
  }
  return { fg, bg, soft }
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

function diffRgba(a: MaskPixelBuffer, b: MaskPixelBuffer) {
  const n = a.data.length
  const rgba = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i += 1) {
    const aa = a.data[i]! >= 128
    const bb = b.data[i]! >= 128
    const o = i * 4
    if (aa === bb) {
      const g = aa ? 40 : 0
      rgba[o] = g
      rgba[o + 1] = g
      rgba[o + 2] = g
      rgba[o + 3] = 255
    } else if (aa && !bb) {
      rgba[o] = 255
      rgba[o + 1] = 40
      rgba[o + 2] = 40
      rgba[o + 3] = 255
    } else {
      rgba[o] = 40
      rgba[o + 1] = 220
      rgba[o + 2] = 255
      rgba[o + 3] = 255
    }
  }
  return rgba
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

/** Mirrors App batch path: commit to maskStore, then export via getMask. */
async function runAsBatchUi(
  imageId: string,
  imageData: ImageData,
  method: AutoMaskMethod,
) {
  getOrCreateMask(imageId, imageData.width, imageData.height)
  const result = await runAutoMaskPipeline(imageData, method, 40)
  setMask(imageId, result.mask)
  const stored = getMask(imageId)!
  return { result, stored }
}

mkdirSync(outDir, { recursive: true })
for (const sub of ['masks', 'beige', 'diff', 'diagnostics'] as const) {
  mkdirSync(join(outDir, sub), { recursive: true })
}

const report: unknown[] = []

console.log('\n=== Contour validation + strategy UI simulation ===\n')

for (const fixture of FIXTURES) {
  const base = fixture.name.replace(/\.jpg$/i, '')
  const imageData = decodeJpeg(join(clothingDir, fixture.name))
  const n = imageData.width * imageData.height
  const byMethod: Record<string, unknown> = {}

  clearAllMasks()

  // Direct contour diagnostics (Stage D evidence).
  const cfDirect = segmentGarmentContourFirst(imageData, { includeDebug: true })
  writeFileSync(
    join(outDir, 'diagnostics', `${base}-contour.json`),
    JSON.stringify(
      {
        methodUsed: cfDirect.methodUsed,
        needsReview: cfDirect.needsReview,
        contourAccepted: cfDirect.diagnostics.contourAccepted,
        rejectReason: cfDirect.diagnostics.rejectReason,
        fallbackReason: cfDirect.diagnostics.fallbackReason,
        validation: cfDirect.diagnostics.validation,
      },
      null,
      2,
    ),
  )

  let labMask: MaskPixelBuffer | null = null
  let contourMask: MaskPixelBuffer | null = null

  for (const method of STRATEGIES) {
    const imageId = `${base}-${method}`
    const { result, stored } = await runAsBatchUi(imageId, imageData, method)
    const sum = checksum(stored)
    const c = counts(stored)
    byMethod[method] = {
      requested: method,
      methodUsed: result.methodUsed,
      checksum: sum,
      storeMatchesPipeline: checksum(stored) === checksum(result.mask),
      needsReview: result.needsReview,
      confidence: result.confidence,
      contourAccepted: result.contourDiagnostics?.contourAccepted,
      rejectReason: result.contourDiagnostics?.rejectReason,
      fallbackReason: result.contourDiagnostics?.fallbackReason,
      validation: result.contourDiagnostics?.validation,
      ...c,
    }
    writePng(
      join(outDir, 'masks', `${base}-${method}-${result.methodUsed}.png`),
      imageData.width,
      imageData.height,
      maskRgba(stored.data, n),
    )
    writePng(
      join(outDir, 'beige', `${base}-${method}.png`),
      imageData.width,
      imageData.height,
      compositePixelBuffers(imageData.data, stored.data, fillBg(n, BEIGE)),
    )
    console.log(
      JSON.stringify({
        fixture: base,
        role: fixture.role,
        requested: method,
        methodUsed: result.methodUsed,
        needsReview: result.needsReview,
        accepted: result.contourDiagnostics?.contourAccepted,
        reject: result.contourDiagnostics?.rejectReason,
        checksum: sum,
        ...c,
      }),
    )
    if (method === 'auto') labMask = stored
    if (method === 'contour') contourMask = stored
  }

  if (labMask && contourMask) {
    writePng(
      join(outDir, 'diff', `${base}-lab-vs-contour.png`),
      imageData.width,
      imageData.height,
      diffRgba(labMask, contourMask),
    )
  }

  // Optional ISNet — only when explicitly requested; record availability.
  let isnet: unknown = { attempted: false }
  try {
    const { result, stored } = await runAsBatchUi(
      `${base}-isnet`,
      imageData,
      'isnet',
    )
    isnet = {
      attempted: true,
      available: true,
      methodUsed: result.methodUsed,
      genuineModelInference: result.genuineModelInference,
      checksum: checksum(stored),
      needsReview: result.needsReview,
      ...counts(stored),
    }
    writePng(
      join(outDir, 'masks', `${base}-isnet-${result.methodUsed}.png`),
      imageData.width,
      imageData.height,
      maskRgba(stored.data, n),
    )
    writePng(
      join(outDir, 'beige', `${base}-isnet.png`),
      imageData.width,
      imageData.height,
      compositePixelBuffers(imageData.data, stored.data, fillBg(n, BEIGE)),
    )
    console.log(
      JSON.stringify({
        fixture: base,
        requested: 'isnet',
        methodUsed: result.methodUsed,
        genuine: result.genuineModelInference,
      }),
    )
  } catch (err) {
    isnet = {
      attempted: true,
      available: false,
      error: err instanceof Error ? err.message : String(err),
    }
    console.log(
      JSON.stringify({
        fixture: base,
        requested: 'isnet',
        available: false,
        error: isnet.error,
      }),
    )
  }

  report.push({
    fixture: base,
    role: fixture.role,
    contourDirect: {
      methodUsed: cfDirect.methodUsed,
      accepted: cfDirect.diagnostics.contourAccepted,
      rejectReason: cfDirect.diagnostics.rejectReason,
      fallbackReason: cfDirect.diagnostics.fallbackReason,
      validation: cfDirect.diagnostics.validation,
      needsReview: cfDirect.needsReview,
    },
    strategies: byMethod,
    isnet,
  })
}

writeFileSync(join(outDir, 'VALIDATION_REPORT.json'), JSON.stringify(report, null, 2))
console.log(`\nWrote ${outDir}`)
