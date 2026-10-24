/**
 * Release validation for the original uploaded slip dress (Downloads copy).
 * Separates: source dims, Lab-seed proxy diagnostics, and notes that live
 * RMBG must be confirmed in-browser (this script cannot load WebGPU workers).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { createMaskBuffer } from '../src/lib/mask/createMask.ts'
import { analyzeKeepComponents } from '../src/lib/mask/diagnostics/fragmentation.ts'
import { runMaskDiagnostics } from '../src/lib/mask/diagnostics/runMaskDiagnostics.ts'
import { segmentImageLocally } from '../src/lib/mask/localSegment.ts'
import { previewBorderStudioPeel } from '../src/lib/mask/diagnostics/borderStudioRepair.ts'
import { extractAlphaMaskFromRgba } from '../src/lib/mask/apiTransparentPngMask.ts'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'tmp-release-validation')
mkdirSync(outDir, { recursive: true })

const slipPath = resolve(outDir, '07_slip_dress.jpg')
const resultPath = resolve(outDir, '07_slip_dress-result.png')

if (!existsSync(slipPath)) {
  console.error('MISSING original upload copy at', slipPath)
  process.exit(1)
}

const jpgBuf = readFileSync(slipPath)
const decoded = jpeg.decode(jpgBuf, { useTArray: true, formatAsRGBA: true })
const image = {
  width: decoded.width,
  height: decoded.height,
  data: new Uint8ClampedArray(decoded.data),
  colorSpace: 'srgb' as const,
} as ImageData

console.log('=== Original upload ===')
console.log({
  path: slipPath,
  bytes: jpgBuf.length,
  width: image.width,
  height: image.height,
  pixels: image.width * image.height,
})

// Analyze opaque "result" PNG if present — report that it is NOT a transparent mask.
if (existsSync(resultPath)) {
  const png = PNG.sync.read(readFileSync(resultPath))
  let a0 = 0
  let a255 = 0
  let soft = 0
  for (let i = 0; i < png.width * png.height; i += 1) {
    const a = png.data[i * 4 + 3]!
    if (a === 0) a0 += 1
    else if (a === 255) a255 += 1
    else soft += 1
  }
  console.log('=== Downloads result PNG (not used as MaskPixelBuffer) ===')
  console.log({
    width: png.width,
    height: png.height,
    alpha0: a0,
    alpha255: a255,
    soft,
    note:
      a0 === 0 && soft === 0
        ? 'Fully opaque — composite/export, not raw RMBG alpha. Cannot substitute for saved mask.'
        : 'Has transparency — could extract alpha.',
  })
  if (a0 > 0 || soft > 0) {
    const mask = extractAlphaMaskFromRgba(
      new Uint8ClampedArray(png.data),
      png.width,
      png.height,
    )
    const frag = analyzeKeepComponents(mask)
    const diag = runMaskDiagnostics({
      mask,
      imageData: image.width === png.width ? image : undefined,
      profile: 'neural',
      method: 'extracted-from-result-png',
    })
    console.log('extracted alpha diagnostics', {
      needsReview: diag.needsReview,
      reasons: diag.reviewReasons,
      fragmentation: frag.summary,
    })
  }
}

// Lab-seed on original (proxy only)
const lab = await segmentImageLocally(image, { tolerance: 40 })
const labFrag = analyzeKeepComponents(lab.mask)
const labDiag = runMaskDiagnostics({
  mask: lab.mask,
  imageData: image,
  profile: 'classical',
  method: lab.methodUsed,
})
const labNeural = runMaskDiagnostics({
  mask: {
    width: lab.mask.width,
    height: lab.mask.height,
    data: new Uint8ClampedArray(lab.mask.data),
  },
  imageData: image,
  profile: 'neural',
  method: 'neural-on-lab-proxy',
})

const keep = lab.mask.data.reduce((n, v) => n + (v >= 128 ? 1 : 0), 0)
const soft = lab.mask.data.reduce(
  (n, v) => n + (v > 0 && v < 200 ? 1 : 0),
  0,
)

console.log('=== Lab-seed on original (PROXY — not live RMBG) ===')
console.log({
  method: lab.methodUsed,
  keepPct: (100 * keep) / lab.mask.data.length,
  softPct: (100 * soft) / lab.mask.data.length,
  classicalReview: labDiag.needsReview,
  neuralOnLabProxyReview: labNeural.needsReview,
  fragmentation: labFrag.summary,
  classicalReasons: labDiag.reviewReasons,
  neuralReasons: labNeural.reviewReasons,
})

// Peel preview must not mutate
const before = Array.from(lab.mask.data)
const peel = previewBorderStudioPeel(lab.mask, image)
const after = Array.from(lab.mask.data)
console.log('=== Border peel preview integrity ===')
console.log({
  mutated: before.some((v, i) => v !== after[i]),
  recommendApply: peel.recommendApply,
  reason: peel.reason,
})

const report = {
  originalUpload: {
    available: true,
    path: slipPath,
    width: image.width,
    height: image.height,
    bytes: jpgBuf.length,
  },
  downloadsResultPng: existsSync(resultPath)
    ? {
        available: true,
        isTransparentMask: false,
        note: 'Fully opaque composite — not a saved MaskPixelBuffer',
      }
    : { available: false },
  labSeedProxy: {
    method: lab.methodUsed,
    keepPct: (100 * keep) / lab.mask.data.length,
    softPct: (100 * soft) / lab.mask.data.length,
    classical: {
      needsReview: labDiag.needsReview,
      reasons: labDiag.reviewReasons,
      heuristicScore: labDiag.heuristicScore,
    },
    neuralOnProxy: {
      needsReview: labNeural.needsReview,
      reasons: labNeural.reviewReasons,
      heuristicScore: labNeural.heuristicScore,
    },
    fragmentation: labFrag.summary,
  },
  liveRmbg: {
    status: 'deferred-to-browser',
    note: 'Node cannot run bg-remove-sdk Web Worker/WebGPU. Live results written by browser probe into live-rmbg-slip-dress.json when available.',
  },
  peelPreviewMutates: before.some((v, i) => v !== after[i]),
}

writeFileSync(resolve(outDir, 'slip-dress-node-report.json'), JSON.stringify(report, null, 2))
console.log('\nWrote', resolve(outDir, 'slip-dress-node-report.json'))
console.log('\nLIMITATION: Live RMBG-1.4 on this upload requires browser probe (see release script follow-up).')
