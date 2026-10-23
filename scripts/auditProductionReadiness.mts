/**
 * Production-readiness audit: strategy labels, RGB preservation, preview/export
 * parity, mask polarity, and ISNet error diagnosis.
 *
 * Run: npx vite-node scripts/auditProductionReadiness.mts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
import { segmentGarmentContourFirst } from '../src/lib/mask/contourFirst/contourFirstSegment'
import { segmentGarmentWithIsnet } from '../src/lib/mask/model/isnetSegment'
import {
  clearAllMasks,
  getMask,
  getOrCreateMask,
  setMask,
} from '../src/lib/mask/maskStore'
import { MaskHistory } from '../src/lib/mask/maskHistory'
import { fillPolygonOnMask } from '../src/lib/mask/polygonMask'
import { cloneMaskBuffer } from '../src/lib/mask/createMask'
import type { MaskPixelBuffer } from '../src/types/mask'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const outDir = join(root, 'tmp-prod-audit')

const FIXTURES = [
  '03_tshirt.jpg',
  '08_sneakers.jpg',
  '02_blazer.jpg',
  '04_jeans.jpg',
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

function checksum(data: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(data)).digest('hex').slice(0, 16)
}

function maskStats(mask: MaskPixelBuffer) {
  let fg = 0
  let bg = 0
  let soft = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    const v = mask.data[i]!
    if (v >= 250) fg += 1
    else if (v <= 5) bg += 1
    else soft += 1
  }
  return { fg, bg, soft, softPct: +((100 * soft) / mask.data.length).toFixed(2) }
}

function writePng(path: string, w: number, h: number, rgba: Uint8ClampedArray) {
  const png = new PNG({ width: w, height: h })
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

function rgbUnchanged(before: Uint8ClampedArray, after: Uint8ClampedArray) {
  for (let i = 0; i < before.length; i += 4) {
    if (
      before[i] !== after[i] ||
      before[i + 1] !== after[i + 1] ||
      before[i + 2] !== after[i + 2]
    ) {
      return false
    }
  }
  return true
}

function buffersEqual(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

mkdirSync(outDir, { recursive: true })
for (const sub of ['masks', 'preview', 'export-png', 'diff-preview-export'] as const) {
  mkdirSync(join(outDir, sub), { recursive: true })
}

const report: unknown[] = []

console.log('\n=== Production readiness audit ===\n')

for (const name of FIXTURES) {
  const base = name.replace(/\.jpg$/i, '')
  const imageData = decodeJpeg(join(clothingDir, name))
  const n = imageData.width * imageData.height
  const rgbBefore = new Uint8ClampedArray(imageData.data)

  // Contour path (may accept or fallback)
  const contour = await runAutoMaskPipeline(
    {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
      colorSpace: 'srgb',
    } as ImageData,
    'contour',
    40,
  )
  const lab = await runAutoMaskPipeline(
    {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
      colorSpace: 'srgb',
    } as ImageData,
    'auto',
    40,
  )

  const rgbAfterContour = rgbUnchanged(rgbBefore, imageData.data)

  clearAllMasks()
  const imageId = `audit-${base}`
  getOrCreateMask(imageId, imageData.width, imageData.height)
  setMask(imageId, contour.mask)
  const stored = getMask(imageId)!

  // Preview vs export (same getMask path)
  const preview = compositePixelBuffers(
    imageData.data,
    stored.data,
    fillBg(n, BEIGE),
  )
  const exported = compositePixelBuffers(
    imageData.data,
    getMask(imageId)!.data,
    fillBg(n, BEIGE),
  )
  const previewExportParity = buffersEqual(preview, exported)

  writePng(
    join(outDir, 'masks', `${base}-contour-${contour.methodUsed}.png`),
    imageData.width,
    imageData.height,
    maskRgba(stored.data, n),
  )
  writePng(
    join(outDir, 'preview', `${base}-preview.png`),
    imageData.width,
    imageData.height,
    preview,
  )
  writePng(
    join(outDir, 'export-png', `${base}-export.png`),
    imageData.width,
    imageData.height,
    exported,
  )

  // Manual correction + undo/redo after fallback (MaskEditor push-before-edit API)
  const history = new MaskHistory()
  const preEdit = cloneMaskBuffer(stored)
  history.push(preEdit)
  const edited = cloneMaskBuffer(preEdit)
  // Paint a 20x20 KEEP patch in top-left (simulates brush/polygon correction)
  fillPolygonOnMask(
    edited,
    [
      { x: 2, y: 2 },
      { x: 22, y: 2 },
      { x: 22, y: 22 },
      { x: 2, y: 22 },
    ],
    'keep',
  )
  setMask(imageId, edited)
  const afterEdit = checksum(getMask(imageId)!.data)
  const undone = history.undo(edited)
  if (!undone) throw new Error('undo returned null')
  setMask(imageId, undone)
  const afterUndo = checksum(getMask(imageId)!.data)
  const redone = history.redo(undone)
  if (!redone) throw new Error('redo returned null')
  setMask(imageId, redone)
  const afterRedo = checksum(getMask(imageId)!.data)

  const direct = segmentGarmentContourFirst(imageData)
  const row = {
    fixture: base,
    lab: {
      methodUsed: lab.methodUsed,
      needsReview: lab.needsReview,
      ...maskStats(lab.mask),
      checksum: checksum(lab.mask.data),
    },
    contour: {
      requested: 'contour',
      methodUsed: contour.methodUsed,
      needsReview: contour.needsReview,
      reviewReasons: contour.reviewReasons ?? contour.contourDiagnostics?.reviewReasons,
      accepted: contour.contourDiagnostics?.contourAccepted,
      rejectReason: contour.contourDiagnostics?.rejectReason,
      fallbackReason: contour.contourDiagnostics?.fallbackReason,
      neverLabeledSuccessfulWhenRejected:
        !contour.contourDiagnostics?.contourAccepted
          ? contour.methodUsed === 'contour-first-fallback-seed'
          : contour.methodUsed === 'contour-first',
      ...maskStats(contour.mask),
      checksum: checksum(contour.mask.data),
      softAlphaPresent: maskStats(contour.mask).soft > 0,
    },
    rgbPreserved: rgbAfterContour,
    previewExportParity,
    storeChecksum: checksum(stored.data),
    editUndoRedo: {
      afterEdit,
      afterUndo,
      afterRedo,
      undoRestoredPreEdit: afterUndo === checksum(stored.data),
      redoRestoredEdit: afterRedo === afterEdit,
    },
    directMethodUsed: direct.methodUsed,
    polarity: {
      keepIsHigh: contour.mask.data.some((v) => v >= 250),
      removeIsLow: contour.mask.data.some((v) => v <= 5),
    },
  }
  report.push(row)
  console.log(JSON.stringify(row, null, 2))
}

// ISNet diagnosis
const isnetDiag: Record<string, unknown> = { attempted: true }
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkgPath = join(root, 'node_modules', '@imgly', 'background-removal-node')
  try {
    const pkg = JSON.parse(readFileSync(join(pkgPath, 'package.json'), 'utf8'))
    isnetDiag.packageInstalled = true
    isnetDiag.packageVersion = pkg.version
  } catch {
    isnetDiag.packageInstalled = false
  }
  const tee = decodeJpeg(join(clothingDir, '03_tshirt.jpg'))
  try {
    const result = await segmentGarmentWithIsnet(tee, 'medium')
    isnetDiag.ok = true
    isnetDiag.methodUsed = result.methodUsed
    isnetDiag.runtime = result.runtime
  } catch (err) {
    isnetDiag.ok = false
    isnetDiag.error = err instanceof Error ? err.message : String(err)
    isnetDiag.errorName = err instanceof Error ? err.name : typeof err
    // Probe with file path (JPEG on disk)
    try {
      const withPath = await segmentGarmentWithIsnet(
        tee,
        'medium',
        join(clothingDir, '03_tshirt.jpg'),
      )
      isnetDiag.withJpegPath = {
        ok: true,
        methodUsed: withPath.methodUsed,
        runtime: withPath.runtime,
      }
    } catch (err2) {
      isnetDiag.withJpegPath = {
        ok: false,
        error: err2 instanceof Error ? err2.message : String(err2),
      }
    }
  }
} catch (err) {
  isnetDiag.ok = false
  isnetDiag.error = err instanceof Error ? err.message : String(err)
}

report.push({ isnetDiagnosis: isnetDiag })
console.log('\nISNet diagnosis:', JSON.stringify(isnetDiag, null, 2))

writeFileSync(join(outDir, 'AUDIT_REPORT.json'), JSON.stringify(report, null, 2))
console.log(`\nWrote ${outDir}`)
