/**
 * End-to-end beach-background composites using production mask polarity
 * and cover-fit background scaling (default app fitMode).
 *
 * Inputs:
 *   - public/testdata/clothing/0{1-10}_*.jpg
 *   - public/testdata/clothing/13_beach.jpg (294×186)
 *   - tmp-isnet-refine/isnet-refined/masks/* (preferred) or isnet-raw
 *
 * Outputs: tmp-beach-audit/
 *
 * Run: npx vite-node scripts/evalBeachComposite.mts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import { measureUniformBorderInset } from '../src/lib/rendering/renderBackground'
import { createMaskBuffer } from '../src/lib/mask/createMask'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const beachPath = join(clothingDir, '13_beach.jpg')
const refinedMaskDir = join(root, 'tmp-isnet-refine', 'isnet-refined', 'masks')
const rawMaskDir = join(root, 'tmp-isnet-refine', 'isnet-raw', 'masks')
const labMaskDir = join(root, 'tmp-isnet-refine', 'lab-seed', 'masks')
const outDir = join(root, 'tmp-beach-audit')

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

function decodeJpeg(path: string) {
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
  }
}

function loadMaskPng(path: string) {
  const png = PNG.sync.read(readFileSync(path))
  const mask = createMaskBuffer(png.width, png.height, 0)
  for (let i = 0; i < mask.data.length; i += 1) {
    mask.data[i] = png.data[i * 4]!
  }
  return mask
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

/** Cover-fit sample: matches renderBackground drawBackgroundImage('cover') with inset trim. */
function coverSampleBeach(
  beach: { width: number; height: number; data: Uint8ClampedArray },
  tw: number,
  th: number,
): Uint8ClampedArray {
  const inset = measureUniformBorderInset(beach.data, beach.width, beach.height)
  const left = inset.left
  const top = inset.top
  const cw = Math.max(1, beach.width - inset.left - inset.right)
  const ch = Math.max(1, beach.height - inset.top - inset.bottom)
  const scale = Math.max(tw / cw, th / ch)
  const dw = cw * scale
  const dh = ch * scale
  const dx = (tw - dw) / 2
  const dy = (th - dh) / 2
  const out = new Uint8ClampedArray(tw * th * 4)
  for (let y = 0; y < th; y += 1) {
    for (let x = 0; x < tw; x += 1) {
      const u = left + (x - dx) / scale
      const v = top + (y - dy) / scale
      const sx = Math.min(
        beach.width - 1,
        Math.max(0, Math.floor(u)),
      )
      const sy = Math.min(
        beach.height - 1,
        Math.max(0, Math.floor(v)),
      )
      const si = (sy * beach.width + sx) * 4
      const o = (y * tw + x) * 4
      out[o] = beach.data[si]!
      out[o + 1] = beach.data[si + 1]!
      out[o + 2] = beach.data[si + 2]!
      out[o + 3] = 255
    }
  }
  return out
}

function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** Corner band studio-like rate among REMOVE pixels (original BG leak). */
function cornerStudioLeak(
  composite: Uint8ClampedArray,
  original: Uint8ClampedArray,
  beachBg: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
): {
  leakRate: number
  cornerSamples: number
  meanDistToOriginal: number
  meanDistToBeach: number
} {
  const band = Math.max(4, Math.floor(Math.min(width, height) * 0.06))
  let samples = 0
  let leak = 0
  let distOrig = 0
  let distBeach = 0
  const consider = (x: number, y: number) => {
    const i = y * width + x
    if (mask[i]! >= 128) return // garment KEEP — skip
    samples += 1
    const o = i * 4
    const cr = composite[o]!
    const cg = composite[o + 1]!
    const cb = composite[o + 2]!
    const or_ = original[o]!
    const og = original[o + 1]!
    const ob = original[o + 2]!
    const br = beachBg[o]!
    const bg = beachBg[o + 1]!
    const bb = beachBg[o + 2]!
    const dO = Math.hypot(cr - or_, cg - og, cb - ob)
    const dB = Math.hypot(cr - br, cg - bg, cb - bb)
    distOrig += dO
    distBeach += dB
    // Closer to original studio than to beach ⇒ original-BG remnant.
    if (dO + 8 < dB) leak += 1
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        x < band ||
        y < band ||
        x >= width - band ||
        y >= height - band
      ) {
        consider(x, y)
      }
    }
  }
  return {
    leakRate: samples > 0 ? leak / samples : 0,
    cornerSamples: samples,
    meanDistToOriginal: samples > 0 ? distOrig / samples : 0,
    meanDistToBeach: samples > 0 ? distBeach / samples : 0,
  }
}

function maskOverlay(
  original: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(original.length)
  for (let i = 0; i < mask.length; i += 1) {
    const o = i * 4
    const keep = mask[i]! >= 128
    out[o] = keep ? original[o]! : Math.round(original[o]! * 0.35 + 40)
    out[o + 1] = keep
      ? original[o + 1]!
      : Math.round(original[o + 1]! * 0.35 + 180)
    out[o + 2] = keep
      ? original[o + 2]!
      : Math.round(original[o + 2]! * 0.35 + 80)
    out[o + 3] = 255
  }
  void width
  void height
  return out
}

if (!existsSync(beachPath)) {
  console.error('MISSING beach:', beachPath)
  process.exit(1)
}

const beach = decodeJpeg(beachPath)
console.log('beach', beachPath, `${beach.width}x${beach.height}`)

mkdirSync(join(outDir, 'beach-cover'), { recursive: true })
mkdirSync(join(outDir, 'composite-refined'), { recursive: true })
mkdirSync(join(outDir, 'composite-raw'), { recursive: true })
mkdirSync(join(outDir, 'composite-lab'), { recursive: true })
mkdirSync(join(outDir, 'overlay-refined'), { recursive: true })
mkdirSync(join(outDir, 'stages'), { recursive: true })

const summary: unknown[] = []

for (const file of FIXTURES) {
  const stem = file.replace(/\.jpg$/i, '')
  const srcPath = join(clothingDir, file)
  if (!existsSync(srcPath)) {
    summary.push({ file, error: 'missing-source' })
    console.warn('MISSING source', file)
    continue
  }
  const refinedPath = join(refinedMaskDir, `${stem}-mask.png`)
  const rawPath = join(rawMaskDir, `${stem}-mask.png`)
  if (!existsSync(refinedPath) && !existsSync(rawPath)) {
    summary.push({ file, error: 'missing-mask' })
    console.warn('MISSING mask', stem)
    continue
  }

  const src = decodeJpeg(srcPath)
  const refined = existsSync(refinedPath)
    ? loadMaskPng(refinedPath)
    : loadMaskPng(rawPath)
  const raw = existsSync(rawPath) ? loadMaskPng(rawPath) : refined

  if (refined.width !== src.width || refined.height !== src.height) {
    summary.push({
      file,
      error: 'mask-dimension-mismatch',
      source: `${src.width}x${src.height}`,
      mask: `${refined.width}x${refined.height}`,
    })
    console.warn('DIM MISMATCH', file, src.width, refined.width)
    continue
  }

  const band = Math.max(4, Math.floor(Math.min(src.width, src.height) * 0.06))
  const beachCover = coverSampleBeach(beach, src.width, src.height)
  writePng(
    join(outDir, 'beach-cover', `${stem}-beach-cover.png`),
    src.width,
    src.height,
    beachCover,
  )

  const compRefined = compositePixelBuffers(src.data, refined.data, beachCover)
  const compRaw = compositePixelBuffers(src.data, raw.data, beachCover)
  writePng(
    join(outDir, 'composite-refined', `${stem}-beach.png`),
    src.width,
    src.height,
    compRefined,
  )
  writePng(
    join(outDir, 'composite-raw', `${stem}-beach.png`),
    src.width,
    src.height,
    compRaw,
  )
  let labCornerKeep: number | null = null
  let labLeak: number | null = null
  if (existsSync(join(labMaskDir, `${stem}-mask.png`))) {
    const lab = loadMaskPng(join(labMaskDir, `${stem}-mask.png`))
    if (lab.width === src.width && lab.height === src.height) {
      const compLab = compositePixelBuffers(src.data, lab.data, beachCover)
      writePng(
        join(outDir, 'composite-lab', `${stem}-beach.png`),
        src.width,
        src.height,
        compLab,
      )
      const ll = cornerStudioLeak(
        compLab,
        src.data,
        beachCover,
        lab.data,
        src.width,
        src.height,
      )
      labLeak = ll.leakRate
      let ck = 0
      let ct = 0
      for (let y = 0; y < src.height; y += 1) {
        for (let x = 0; x < src.width; x += 1) {
          if (
            x < band ||
            y < band ||
            x >= src.width - band ||
            y >= src.height - band
          ) {
            ct += 1
            if (lab.data[y * src.width + x]! >= 128) ck += 1
          }
        }
      }
      labCornerKeep = ck / ct
    }
  }
  writePng(
    join(outDir, 'overlay-refined', `${stem}-overlay.png`),
    src.width,
    src.height,
    maskOverlay(src.data, refined.data, src.width, src.height),
  )

  // Stage dump for first failing-looking candidate (coat + tee always).
  if (stem === '05_coat' || stem === '03_tshirt' || stem === '01_hoodie') {
    writePng(
      join(outDir, 'stages', `${stem}-01-original.png`),
      src.width,
      src.height,
      src.data,
    )
    const maskRgba = new Uint8ClampedArray(src.width * src.height * 4)
    for (let i = 0; i < refined.data.length; i += 1) {
      const v = refined.data[i]!
      const o = i * 4
      maskRgba[o] = v
      maskRgba[o + 1] = v
      maskRgba[o + 2] = v
      maskRgba[o + 3] = 255
    }
    writePng(
      join(outDir, 'stages', `${stem}-02-mask-refined.png`),
      src.width,
      src.height,
      maskRgba,
    )
    writePng(
      join(outDir, 'stages', `${stem}-03-beach-cover.png`),
      src.width,
      src.height,
      beachCover,
    )
    writePng(
      join(outDir, 'stages', `${stem}-04-composite.png`),
      src.width,
      src.height,
      compRefined,
    )
  }

  const leak = cornerStudioLeak(
    compRefined,
    src.data,
    beachCover,
    refined.data,
    src.width,
    src.height,
  )

  // Corner KEEP rate — high corner KEEP often looks like rectangular studio slab.
  let cornerKeep = 0
  let cornerTot = 0
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      if (
        x < band ||
        y < band ||
        x >= src.width - band ||
        y >= src.height - band
      ) {
        cornerTot += 1
        if (refined.data[y * src.width + x]! >= 128) cornerKeep += 1
      }
    }
  }

  const row = {
    file,
    source: `${src.width}x${src.height}`,
    beachNative: `${beach.width}x${beach.height}`,
    beachScaledCover: `${src.width}x${src.height}`,
    mask: `${refined.width}x${refined.height}`,
    dimensionsAligned: true,
    cornerKeepRate: cornerKeep / cornerTot,
    studioLeakRate: leak.leakRate,
    meanDistToOriginal: leak.meanDistToOriginal,
    meanDistToBeach: leak.meanDistToBeach,
    likelyOriginalBgRemnant: leak.leakRate > 0.15,
    likelyCornerSlabKeep: cornerKeep / cornerTot > 0.12,
    labCornerKeepRate: labCornerKeep,
    labStudioLeakRate: labLeak,
  }
  summary.push(row)
  console.log(
    stem,
    'leak=' + leak.leakRate.toFixed(3),
    'cornerKeep=' + (cornerKeep / cornerTot).toFixed(3),
    'labCorner=' + (labCornerKeep?.toFixed(3) ?? 'n/a'),
    'labLeak=' + (labLeak?.toFixed(3) ?? 'n/a'),
  )
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log('wrote', outDir)
