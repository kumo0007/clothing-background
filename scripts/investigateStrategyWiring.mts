/**
 * Prove which auto-mask strategies actually run, whether masks differ, and
 * where contour-first first goes wrong on tee/sneakers.
 *
 * Run: npx vite-node scripts/investigateStrategyWiring.mts
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
import {
  detectCandidateEdges,
  buildEdgeBarriers,
  closeBarrierGaps,
  floodExteriorThroughGaps,
  validateContourCandidate,
  fillFromValidatedContour,
  segmentGarmentContourFirst,
} from '../src/lib/mask/contourFirst/contourFirstSegment'
import { segmentGarmentBySeeds } from '../src/lib/mask/opencv/segmentSeeds'
import {
  clearAllMasks,
  getMask,
  getOrCreateMask,
  setMask,
} from '../src/lib/mask/maskStore'
import type { MaskPixelBuffer } from '../src/types/mask'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const outDir = join(root, 'tmp-strategy-wiring')

const FIXTURES = [
  '01_hoodie.jpg',
  '02_blazer.jpg',
  '03_tshirt.jpg',
  '04_jeans.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
] as const

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

function checksum(mask: MaskPixelBuffer): string {
  return createHash('sha256').update(Buffer.from(mask.data)).digest('hex').slice(0, 16)
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
  return { fg, bg, soft, total: mask.data.length }
}

function disagree(
  a: MaskPixelBuffer,
  b: MaskPixelBuffer,
  thr = 128,
): { n: number; pct: number } {
  let n = 0
  for (let i = 0; i < a.data.length; i += 1) {
    const aa = a.data[i]! >= thr ? 1 : 0
    const bb = b.data[i]! >= thr ? 1 : 0
    if (aa !== bb) n += 1
  }
  return { n, pct: (100 * n) / a.data.length }
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
      // Lab KEEP, contour REMOVE — red
      rgba[o] = 255
      rgba[o + 1] = 40
      rgba[o + 2] = 40
      rgba[o + 3] = 255
    } else {
      // Contour KEEP, Lab REMOVE — cyan
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

/** Simulate UI batch default (no method arg) vs explicit strategies. */
async function simulateUiBatchDefault(
  imageId: string,
  imageData: ImageData,
): Promise<{ requested: string; methodUsed: string; checksum: string }> {
  // Mirrors autoMaskCornersForImage default method = 'auto'
  const requested: AutoMaskMethod = 'auto'
  getOrCreateMask(imageId, imageData.width, imageData.height)
  const result = await runAutoMaskPipeline(imageData, requested, 40)
  setMask(imageId, result.mask)
  const stored = getMask(imageId)!
  return {
    requested,
    methodUsed: result.methodUsed,
    checksum: checksum(stored),
  }
}

mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, 'masks'), { recursive: true })
mkdirSync(join(outDir, 'diff'), { recursive: true })
mkdirSync(join(outDir, 'beige'), { recursive: true })
mkdirSync(join(outDir, 'stages'), { recursive: true })

const report: unknown[] = []

console.log('\n=== UI batch default vs explicit strategies ===\n')

for (const name of FIXTURES) {
  const base = name.replace(/\.jpg$/i, '')
  const imageData = decodeJpeg(join(clothingDir, name))
  const n = imageData.width * imageData.height
  clearAllMasks()

  const ui = await simulateUiBatchDefault(`ui-${base}`, imageData)

  const strategies: AutoMaskMethod[] = ['auto', 'contour']
  const byStrategy: Record<string, ReturnType<typeof counts> & { checksum: string; methodUsed: string; requested: string }> = {}

  for (const requested of strategies) {
    const before = imageData.data.slice(0, 16)
    const result = await runAutoMaskPipeline(imageData, requested, 40)
    const after = imageData.data.slice(0, 16)
    const rgbOk = before.every((v, i) => v === after[i])
    const c = counts(result.mask)
    const sum = checksum(result.mask)
    byStrategy[requested] = {
      ...c,
      checksum: sum,
      methodUsed: result.methodUsed,
      requested,
    }
    writePng(
      join(outDir, 'masks', `${base}-${requested}-${result.methodUsed}.png`),
      imageData.width,
      imageData.height,
      maskRgba(result.mask.data, n),
    )
    writePng(
      join(outDir, 'beige', `${base}-${requested}.png`),
      imageData.width,
      imageData.height,
      compositePixelBuffers(imageData.data, result.mask.data, fillBg(n, BEIGE)),
    )
    console.log(
      JSON.stringify({
        fixture: base,
        requested,
        methodUsed: result.methodUsed,
        fallback:
          requested === 'contour' && result.methodUsed !== 'contour-first'
            ? 'UNEXPECTED'
            : requested === 'auto' && result.methodUsed === 'opencv-seed-fallback'
              ? 'lab-seed-default'
              : 'none',
        checksum: sum,
        ...c,
        sourceRgbUnchanged: rgbOk,
        dims: `${result.mask.width}x${result.mask.height}`,
      }),
    )
  }

  // Commit contour mask and prove store + re-read checksum match export path.
  clearAllMasks()
  const contourRun = await runAutoMaskPipeline(imageData, 'contour', 40)
  setMask(`export-${base}`, contourRun.mask)
  const fromStore = getMask(`export-${base}`)!
  const exportComposite = compositePixelBuffers(
    imageData.data,
    fromStore.data,
    fillBg(n, BEIGE),
  )
  const directComposite = compositePixelBuffers(
    imageData.data,
    contourRun.mask.data,
    fillBg(n, BEIGE),
  )
  let exportParity = true
  for (let i = 0; i < exportComposite.length; i += 1) {
    if (exportComposite[i] !== directComposite[i]) {
      exportParity = false
      break
    }
  }

  const labMask = (
    await runAutoMaskPipeline(cloneImage(imageData), 'auto', 40)
  ).mask
  const cfMask = (
    await runAutoMaskPipeline(cloneImage(imageData), 'contour', 40)
  ).mask
  const d = disagree(labMask, cfMask)
  writePng(
    join(outDir, 'diff', `${base}-lab-vs-contour.png`),
    imageData.width,
    imageData.height,
    diffRgba(labMask, cfMask),
  )

  report.push({
    fixture: base,
    uiBatchDefault: ui,
    strategies: byStrategy,
    labVsContourDisagree: d,
    masksIdentical: d.n === 0,
    storeExportParity: exportParity,
    storeChecksumMatchesPipeline:
      checksum(fromStore) === checksum(contourRun.mask),
  })
}

function cloneImage(image: ImageData): ImageData {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
    colorSpace: 'srgb',
  } as ImageData
}

/** Stage-by-stage contour failure pin for tee + sneakers. */
console.log('\n=== Contour-first first-failing-stage (tee / sneakers) ===\n')

for (const name of ['03_tshirt.jpg', '08_sneakers.jpg'] as const) {
  const base = name.replace(/\.jpg$/i, '')
  const imageData = decodeJpeg(join(clothingDir, name))
  const { width, height } = imageData
  const stages: Array<Record<string, unknown>> = []

  const seed = segmentGarmentBySeeds(imageData).mask
  stages.push({ stage: 'seed-prior', ...counts(seed), checksum: checksum(seed) })

  const edges = detectCandidateEdges(imageData)
  let edgeStrong = 0
  for (let i = 0; i < edges.length; i += 1) if (edges[i]! >= 40) edgeStrong += 1
  stages.push({
    stage: 'A-edges',
    strongEdgePx: edgeStrong,
    edgeDensity: +(edgeStrong / edges.length).toFixed(4),
  })
  writePng(
    join(outDir, 'stages', `${base}-A-edges.png`),
    width,
    height,
    maskRgba(edges, width * height),
  )

  let edgeSum = 0
  let edgeN = 0
  for (let i = 0; i < edges.length; i += 1) {
    if (edges[i]! > 8) {
      edgeSum += edges[i]!
      edgeN += 1
    }
  }
  const edgeThr = Math.max(28, Math.min(72, Math.round((edgeN ? edgeSum / edgeN : 40) * 0.85)))
  let barriers = buildEdgeBarriers(edges, width, height, seed, edgeThr)
  stages.push({
    stage: 'A-barriers',
    barrierPx: counts({ width, height, data: barriers } as MaskPixelBuffer).fg,
    edgeThr,
  })
  writePng(
    join(outDir, 'stages', `${base}-A-barriers.png`),
    width,
    height,
    maskRgba(barriers, width * height),
  )

  const closed = closeBarrierGaps(barriers, width, height)
  barriers = closed.closed
  stages.push({
    stage: 'C-gap-close',
    gapClosed: closed.gapClosed,
    substantial: closed.substantial,
    barrierPx: counts({ width, height, data: barriers } as MaskPixelBuffer).fg,
  })

  const flooded = floodExteriorThroughGaps(barriers, width, height)
  const interior = new Uint8ClampedArray(width * height)
  for (let i = 0; i < interior.length; i += 1) {
    if (flooded[i]! < 128 && barriers[i]! < 128) interior[i] = 255
  }
  const interiorMask = {
    width,
    height,
    data: interior,
  } as MaskPixelBuffer
  stages.push({
    stage: 'B-exterior-flood',
    floodedBg: counts({ width, height, data: flooded } as MaskPixelBuffer).fg,
    interiorFg: counts(interiorMask).fg,
    interiorPct: +((100 * counts(interiorMask).fg) / interior.length).toFixed(2),
  })
  writePng(
    join(outDir, 'stages', `${base}-B-interior.png`),
    width,
    height,
    maskRgba(interior, width * height),
  )

  const validation = validateContourCandidate(
    interior,
    width,
    height,
    seed,
    flooded,
  )
  stages.push({
    stage: 'D-validate',
    ok: validation.ok,
    reason: validation.reason,
    areaRatio: validation.areaRatio,
    seedAgreement: validation.seedAgreement,
    borderTouchRatio: validation.borderTouchRatio,
  })

  let firstFail = 'none'
  if (!validation.ok) {
    firstFail = `D-validate:${validation.reason}`
  } else {
    // Compare interior vs seed: if interior includes huge near-card region
    // while seed is uncertain, fill is already wrong before refine.
    const filled = fillFromValidatedContour(width, height, interior, seed)
    const c = counts(filled)
    stages.push({ stage: 'E-fill', ...c, checksum: checksum(filled) })
    writePng(
      join(outDir, 'stages', `${base}-E-fill.png`),
      width,
      height,
      maskRgba(filled.data, width * height),
    )

    // Heuristic: if interior covers >45% of frame on a near-white product,
    // first fail is B (barrier followed card / incomplete garment edge).
    if (validation.areaRatio > 0.45) {
      firstFail =
        'B-exterior-flood:interior-too-large (edge barrier followed card or missed garment edge)'
    } else if (closed.substantial && validation.seedAgreement < 0.5) {
      firstFail =
        'C-gap-close:substantial + D-validate:accepted-weak-seedAgreement (unrelated edges joined; wrong silhouette accepted)'
    } else if (validation.seedAgreement < 0.35) {
      firstFail =
        'B/D: low seed agreement — contour silhouette diverges from structure prior'
    }

    const fillFg = counts(filled).fg
    const final = segmentGarmentContourFirst(imageData, { includeDebug: true })
    const finalFg = counts(final.mask).fg
    stages.push({
      stage: 'final',
      accepted: final.diagnostics.contourAccepted,
      methodUsed: final.methodUsed,
      rejectReason: final.diagnostics.rejectReason,
      ...counts(final.mask),
      checksum: checksum(final.mask),
      fillToFinalDrop: fillFg - finalFg,
    })

    // Open-arch / island cleanup erased a huge fraction of the filled mask.
    if (
      firstFail === 'none' &&
      fillFg > 0 &&
      finalFg < fillFg * 0.45
    ) {
      firstFail =
        'open-arch/island-cleanup: removed majority of E-fill (likely real product + studio)'
    }
  }

  // Also note if edges are too weak on pale-vs-pale
  if (edgeStrong / edges.length < 0.02) {
    firstFail =
      firstFail === 'none'
        ? 'A-edges: insufficient strong gradients (white-on-white)'
        : `A-edges-weak + ${firstFail}`
  }

  const row = { fixture: base, firstFail, stages }
  report.push({ contourStageProbe: row })
  console.log(JSON.stringify(row, null, 2))
}

writeFileSync(join(outDir, 'WIRING_REPORT.json'), JSON.stringify(report, null, 2))
console.log(`\nWrote ${outDir}`)
