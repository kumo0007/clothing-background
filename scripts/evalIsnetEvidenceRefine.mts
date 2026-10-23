/**
 * Side-by-side eval: raw-cleanup ISNet vs evidence-refined ISNet vs Lab vs Contour.
 *
 * Writes masks, beige exports, and raw-vs-refined diff under tmp-isnet-refine/.
 * Run: npx vite-node scripts/evalIsnetEvidenceRefine.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import {
  runAutoMaskPipeline,
  runIsnetAutoMask,
} from '../src/lib/mask/autoMaskPipeline'
import { cloneMaskBuffer } from '../src/lib/mask/createMask'
import { segmentGarmentWithIsnet } from '../src/lib/mask/model/isnetSegment'
import {
  stripForeignBorderBands,
  removeBrightEdgeChrome,
  stripOpenArchStudio,
} from '../src/lib/mask/selectSimilar'
import { featherMaskEdges } from '../src/lib/mask/refineMask'
import { refineIsnetWithEvidence } from '../src/lib/mask/isnetEvidenceRefine'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const outDir = join(root, 'tmp-isnet-refine')

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

function maskToRgba(mask: { width: number; height: number; data: Uint8ClampedArray }) {
  const rgba = new Uint8ClampedArray(mask.width * mask.height * 4)
  for (let i = 0; i < mask.data.length; i += 1) {
    const o = i * 4
    const v = mask.data[i]!
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

function diffMaskRgba(
  before: { data: Uint8ClampedArray; width: number; height: number },
  after: { data: Uint8ClampedArray; width: number; height: number },
) {
  const rgba = new Uint8ClampedArray(before.width * before.height * 4)
  for (let i = 0; i < before.data.length; i += 1) {
    const o = i * 4
    const b = before.data[i]! >= 128
    const a = after.data[i]! >= 128
    if (b === a) {
      const v = b ? 200 : 40
      rgba[o] = v
      rgba[o + 1] = v
      rgba[o + 2] = v
      rgba[o + 3] = 255
    } else if (!b && a) {
      // Reclaimed — green
      rgba[o] = 40
      rgba[o + 1] = 200
      rgba[o + 2] = 80
      rgba[o + 3] = 255
    } else {
      // Stripped — red
      rgba[o] = 220
      rgba[o + 1] = 40
      rgba[o + 2] = 40
      rgba[o + 3] = 255
    }
  }
  return rgba
}

function fgRatio(data: Uint8ClampedArray) {
  let k = 0
  for (let i = 0; i < data.length; i += 1) if (data[i]! >= 128) k += 1
  return k / data.length
}

async function rawIsnetCleanup(imageData: ImageData, imagePath: string) {
  const seg = await segmentGarmentWithIsnet(imageData, 'medium', imagePath)
  const mask = cloneMaskBuffer(seg.mask)
  stripForeignBorderBands(mask, imageData)
  removeBrightEdgeChrome(mask, imageData)
  stripOpenArchStudio(mask, imageData, 40)
  featherMaskEdges(mask, 1)
  return mask
}

mkdirSync(join(outDir, 'isnet-raw', 'masks'), { recursive: true })
mkdirSync(join(outDir, 'isnet-raw', 'beige'), { recursive: true })
mkdirSync(join(outDir, 'isnet-refined', 'masks'), { recursive: true })
mkdirSync(join(outDir, 'isnet-refined', 'beige'), { recursive: true })
mkdirSync(join(outDir, 'lab-seed', 'masks'), { recursive: true })
mkdirSync(join(outDir, 'lab-seed', 'beige'), { recursive: true })
mkdirSync(join(outDir, 'contour', 'masks'), { recursive: true })
mkdirSync(join(outDir, 'contour', 'beige'), { recursive: true })
mkdirSync(join(outDir, 'diff'), { recursive: true })
mkdirSync(join(outDir, 'diagnostics'), { recursive: true })

const summary: unknown[] = []

for (const file of FIXTURES) {
  const stem = file.replace(/\.jpg$/i, '')
  const path = join(clothingDir, file)
  const image = decodeJpeg(path)
  const srcCopy = new Uint8ClampedArray(image.data)

  const raw = await rawIsnetCleanup(image, path)
  const refinedPipe = await runIsnetAutoMask(image, 40, 'medium', path)
  const lab = await runAutoMaskPipeline(image, 'auto', 40)
  const contour = await runAutoMaskPipeline(image, 'contour', 40)

  // Also run refine directly on raw for diff vs accepted pipeline mask
  const direct = refineIsnetWithEvidence(cloneMaskBuffer(raw), image)

  for (const [bucket, mask] of [
    ['isnet-raw', raw],
    ['isnet-refined', refinedPipe.mask],
    ['lab-seed', lab.mask],
    ['contour', contour.mask],
  ] as const) {
    writePng(
      join(outDir, bucket, 'masks', `${stem}-mask.png`),
      mask.width,
      mask.height,
      maskToRgba(mask),
    )
    const bg = fillBg(mask.width * mask.height, BEIGE)
    const out = compositePixelBuffers(image.data, mask.data, bg)
    writePng(
      join(outDir, bucket, 'beige', `${stem}-result.png`),
      mask.width,
      mask.height,
      out,
    )
  }

  writePng(
    join(outDir, 'diff', `${stem}-raw-vs-refined.png`),
    raw.width,
    raw.height,
    diffMaskRgba(raw, refinedPipe.mask),
  )

  const rgbUnchanged = image.data.every((v, i) => v === srcCopy[i])
  const row = {
    file,
    methodUsed: refinedPipe.methodUsed,
    genuineModelInference: refinedPipe.genuineModelInference,
    needsReview: refinedPipe.needsReview,
    reviewReasons: refinedPipe.reviewReasons,
    refine: refinedPipe.isnetRefineDiagnostics,
    directRefineAccepted: direct.diagnostics.refinementAccepted,
    fg: {
      raw: +fgRatio(raw.data).toFixed(4),
      refined: +fgRatio(refinedPipe.mask.data).toFixed(4),
      lab: +fgRatio(lab.mask.data).toFixed(4),
      contour: +fgRatio(contour.mask.data).toFixed(4),
    },
    rgbUnchanged,
    contourMethod: contour.methodUsed,
    contourNeedsReview: contour.needsReview,
  }
  writeFileSync(
    join(outDir, 'diagnostics', `${stem}.json`),
    JSON.stringify(row, null, 2),
  )
  summary.push(row)
  console.log(
    stem,
    'refine',
    refinedPipe.isnetRefineDiagnostics?.refinementAccepted,
    refinedPipe.isnetRefineDiagnostics?.acceptReason ??
      refinedPipe.isnetRefineDiagnostics?.rejectReason,
    'fg',
    row.fg,
  )
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log('wrote', outDir)
