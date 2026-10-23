/**
 * Baseline vs OpenCV auto-mask comparison on clothing fixtures.
 *
 * Metrics are PROXY scores (vs baseline mask / image heuristics) unless a
 * reviewed reference mask exists — never treat an auto mask as its own GT.
 *
 * Run: npx vite-node scripts/compareAutoMask.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import {
  runBaselineAutoMask,
  runOpenCvAutoMask,
} from '../src/lib/mask/autoMaskPipeline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const outDir = join(root, 'tmp-opencv-compare')

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

const BG_MAGENTA: [number, number, number] = [255, 0, 255]
const BG_BEIGE: [number, number, number] = [232, 220, 200]

function decodeJpeg(path: string): ImageData {
  const raw = readFileSync(path)
  const decoded = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
  const data = new Uint8ClampedArray(
    decoded.data.buffer,
    decoded.data.byteOffset,
    decoded.data.byteLength,
  )
  return {
    width: decoded.width,
    height: decoded.height,
    data,
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

function maskStats(mask: Uint8ClampedArray) {
  let keep = 0
  let soft = 0
  let remove = 0
  for (let i = 0; i < mask.length; i += 1) {
    const v = mask[i]!
    if (v >= 200) keep += 1
    else if (v <= 20) remove += 1
    else soft += 1
  }
  const n = mask.length
  return {
    keepRatio: keep / n,
    softRatio: soft / n,
    removeRatio: remove / n,
  }
}

/** Proxy: fraction of near-border pixels that are REMOVE (higher ≈ cleaner BG). */
function borderRemoveProxy(mask: Uint8ClampedArray, w: number, h: number) {
  const band = Math.max(2, Math.floor(Math.min(w, h) * 0.03))
  let total = 0
  let remove = 0
  const visit = (x: number, y: number) => {
    total += 1
    if (mask[y * w + x]! <= 20) remove += 1
  }
  for (let y = 0; y < band; y += 1) for (let x = 0; x < w; x += 1) visit(x, y)
  for (let y = h - band; y < h; y += 1)
    for (let x = 0; x < w; x += 1) visit(x, y)
  for (let y = band; y < h - band; y += 1) {
    for (let x = 0; x < band; x += 1) visit(x, y)
    for (let x = w - band; x < w; x += 1) visit(x, y)
  }
  return total === 0 ? 0 : remove / total
}

/** Cap footer: bottom 12 rows should be mostly REMOVE. */
function capFooterClean(mask: Uint8ClampedArray, w: number, h: number) {
  let remove = 0
  const rows = Math.min(12, h)
  for (let y = h - rows; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (mask[y * w + x]! <= 20) remove += 1
    }
  }
  return remove / (rows * w)
}

function compositeOn(
  imageData: ImageData,
  mask: Uint8ClampedArray,
  bg: [number, number, number],
) {
  const pixels = imageData.width * imageData.height
  const background = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4
    background[o] = bg[0]
    background[o + 1] = bg[1]
    background[o + 2] = bg[2]
    background[o + 3] = 255
  }
  return compositePixelBuffers(imageData.data, mask, background)
}

function maskRgba(mask: Uint8ClampedArray, w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < mask.length; i += 1) {
    const v = mask[i]!
    const o = i * 4
    rgba[o] = v
    rgba[o + 1] = v
    rgba[o + 2] = v
    rgba[o + 3] = 255
  }
  return rgba
}

mkdirSync(outDir, { recursive: true })

type Row = {
  file: string
  width: number
  height: number
  metricSource: 'proxy-vs-heuristics'
  baseline: ReturnType<typeof maskStats> & {
    elapsedMs: number
    borderRemoveProxy: number
    capFooterClean?: number
  }
  opencv: ReturnType<typeof maskStats> & {
    elapsedMs: number
    methodUsed: string
    borderRemoveProxy: number
    capFooterClean?: number
  }
  notes: string[]
}

const rows: Row[] = []

for (const name of FIXTURES) {
  const imageData = decodeJpeg(join(clothingDir, name))
  const { width, height } = imageData
  const base = name.replace(/\.jpg$/i, '')

  const baseline = runBaselineAutoMask(imageData)
  const opencv = await runOpenCvAutoMask(imageData)

  const bStats = maskStats(baseline.mask.data)
  const oStats = maskStats(opencv.mask.data)
  const notes: string[] = []

  if (name.includes('sneakers')) {
    notes.push(
      'White-on-near-white: prefer FG retention over aggressive BG wipe; inspect leather panels manually.',
    )
  }
  if (name.includes('handbag')) {
    notes.push('Handle interiors: enclosed studio strip is proxy for hole cleanup.')
  }
  if (name.includes('cap')) {
    notes.push('Footer cleanup: bottom-12 REMOVE ratio is a targeted proxy.')
  }
  if (name.includes('dress') || name.includes('coat')) {
    notes.push('Fringe: softRatio + visual magenta QA; no reviewed GT mask.')
  }

  const row: Row = {
    file: name,
    width,
    height,
    metricSource: 'proxy-vs-heuristics',
    baseline: {
      ...bStats,
      elapsedMs: baseline.elapsedMs,
      borderRemoveProxy: borderRemoveProxy(baseline.mask.data, width, height),
      ...(name.includes('cap')
        ? { capFooterClean: capFooterClean(baseline.mask.data, width, height) }
        : {}),
    },
    opencv: {
      ...oStats,
      elapsedMs: opencv.elapsedMs,
      methodUsed: opencv.methodUsed,
      borderRemoveProxy: borderRemoveProxy(opencv.mask.data, width, height),
      ...(name.includes('cap')
        ? { capFooterClean: capFooterClean(opencv.mask.data, width, height) }
        : {}),
    },
    notes,
  }
  rows.push(row)

  for (const [label, mask] of [
    ['baseline', baseline.mask.data],
    ['opencv', opencv.mask.data],
  ] as const) {
    writePng(
      join(outDir, `${base}-${label}-mask.png`),
      width,
      height,
      maskRgba(mask, width, height),
    )
    writePng(
      join(outDir, `${base}-${label}-magenta.png`),
      width,
      height,
      compositeOn(imageData, mask, BG_MAGENTA),
    )
    writePng(
      join(outDir, `${base}-${label}-beige.png`),
      width,
      height,
      compositeOn(imageData, mask, BG_BEIGE),
    )
  }

  console.log(
    `${name} ${width}×${height} | baseline keep=${(bStats.keepRatio * 100).toFixed(1)}% ${baseline.elapsedMs}ms | opencv(${opencv.methodUsed}) keep=${(oStats.keepRatio * 100).toFixed(1)}% ${opencv.elapsedMs}ms`,
  )
}

writeFileSync(join(outDir, 'comparison.json'), JSON.stringify(rows, null, 2))
console.log(`Wrote comparison to ${outDir}`)
