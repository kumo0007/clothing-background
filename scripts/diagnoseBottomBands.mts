/**
 * Diagnose bottom-edge bands in source fixtures vs current mask survival.
 * Run: npx vite-node scripts/diagnoseBottomBands.mts
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { createMaskBuffer } from '../src/lib/mask/createMask'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
import {
  averageCornerColor,
  stripForeignBorderBands,
} from '../src/lib/mask/selectSimilar'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'tmp-source-fixtures-14', 'New folder (14)')
const publicDir = join(root, 'public', 'testdata', 'clothing')

const FILES = [
  '06_sweater.jpg',
  '07_dress.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
  '10_cap.jpg',
] as const

function decode(path: string) {
  const d = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true })
  return {
    width: d.width,
    height: d.height,
    data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
    colorSpace: 'srgb',
  } as ImageData
}

function rowStats(image: ImageData, y: number) {
  const { width, data } = image
  let sumL = 0
  let sumSq = 0
  let dark = 0
  let chromaSum = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4
    const r = data[o]!
    const g = data[o + 1]!
    const b = data[o + 2]!
    const L = 0.299 * r + 0.587 * g + 0.114 * b
    sumL += L
    sumSq += L * L
    sumR += r
    sumG += g
    sumB += b
    if (L < 55) dark++
    chromaSum += Math.max(r, g, b) - Math.min(r, g, b)
  }
  const n = width
  const meanL = sumL / n
  return {
    y,
    meanL: +meanL.toFixed(1),
    var: +(sumSq / n - meanL * meanL).toFixed(1),
    darkRatio: +(dark / n).toFixed(3),
    meanChroma: +(chromaSum / n).toFixed(1),
    mean: {
      r: Math.round(sumR / n),
      g: Math.round(sumG / n),
      b: Math.round(sumB / n),
    },
  }
}

function keepOnRow(mask: Uint8ClampedArray, w: number, y: number) {
  let keep = 0
  for (let x = 0; x < w; x++) if (mask[y * w + x]! >= 128) keep++
  return keep
}

const report: unknown[] = []

for (const name of FILES) {
  const srcPath = join(srcDir, name)
  const pubPath = join(publicDir, name)
  const srcBuf = readFileSync(srcPath)
  const pubBuf = readFileSync(pubPath)
  const same = srcBuf.equals(pubBuf)
  if (!same) {
    copyFileSync(srcPath, pubPath)
    console.log(`UPDATED public fixture from zip: ${name}`)
  }

  const image = decode(srcPath)
  const corner = averageCornerColor(image)
  const bottomRows = []
  for (let i = 0; i < 20; i++) {
    const y = image.height - 1 - i
    bottomRows.push(rowStats(image, y))
  }

  const pipeline = await runAutoMaskPipeline(image, 'opencv')
  const alone = createMaskBuffer(image.width, image.height, 255)
  // Start all KEEP then only strip bands — measure band function alone
  const bandOnly = createMaskBuffer(image.width, image.height, 255)
  const bandPainted = stripForeignBorderBands(bandOnly, image)

  const survival = []
  for (let i = 0; i < 16; i++) {
    const y = image.height - 1 - i
    survival.push({
      y,
      keepPipeline: keepOnRow(pipeline.mask.data, image.width, y),
      keepBandOnly: keepOnRow(bandOnly.data, image.width, y),
      ...rowStats(image, y),
    })
  }

  const entry = {
    name,
    sameAsPublic: same,
    dims: `${image.width}x${image.height}`,
    corner,
    bandPainted,
    bottomRows,
    survival,
  }
  report.push(entry)
  console.log(
    `\n=== ${name} ${image.width}x${image.height} same=${same} corner=${JSON.stringify(corner)} ===`,
  )
  for (const s of survival.slice(0, 12)) {
    console.log(
      `  y=${s.y} keepP=${s.keepPipeline}/${image.width} keepB=${s.keepBandOnly} L=${s.meanL} var=${s.var} dark=${s.darkRatio} chroma=${s.meanChroma} rgb=${s.mean.r},${s.mean.g},${s.mean.b}`,
    )
  }
}

mkdirSync(join(root, 'tmp-quality-pass-exports'), { recursive: true })
writeFileSync(
  join(root, 'tmp-quality-pass-exports', 'bottom-band-diagnose.json'),
  JSON.stringify(report, null, 2),
)
console.log('\nWrote bottom-band-diagnose.json')
