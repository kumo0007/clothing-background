/**
 * Headless Auto-mask + composite export for clothing fixtures.
 * Uses the OpenCV hybrid pipeline (same as autoMaskCornersForImage).
 *
 * Run: npx vite-node scripts/exportClothingFixtures.mts
 * Optional: METHOD=baseline npx vite-node scripts/exportClothingFixtures.mts
 */
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

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const outDir = join(root, 'tmp-quality-pass-exports')

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

/** Magenta card — any leftover studio gray is immediately visible. */
const BG: [number, number, number] = [255, 0, 255]

const method = (process.env.METHOD as AutoMaskMethod | undefined) ?? 'opencv'

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

mkdirSync(outDir, { recursive: true })

const summary: Array<{
  file: string
  width: number
  height: number
  keepRatio: number
  removeRatio: number
  methodUsed: string
  elapsedMs: number
}> = []

for (const name of FIXTURES) {
  const imageData = decodeJpeg(join(clothingDir, name))
  const result = await runAutoMaskPipeline(imageData, method)
  const mask = result.mask
  const pixels = imageData.width * imageData.height
  let keep = 0
  let remove = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! >= 200) keep += 1
    else if (mask.data[i]! <= 20) remove += 1
  }

  const background = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4
    background[o] = BG[0]
    background[o + 1] = BG[1]
    background[o + 2] = BG[2]
    background[o + 3] = 255
  }

  const out = compositePixelBuffers(imageData.data, mask.data, background)
  const base = name.replace(/\.jpg$/i, '')
  writePng(join(outDir, `${base}-result.png`), imageData.width, imageData.height, out)
  writePng(
    join(outDir, `${base}-mask.png`),
    imageData.width,
    imageData.height,
    (() => {
      const rgba = new Uint8ClampedArray(pixels * 4)
      for (let i = 0; i < pixels; i += 1) {
        const v = mask.data[i]!
        const o = i * 4
        rgba[o] = v
        rgba[o + 1] = v
        rgba[o + 2] = v
        rgba[o + 3] = 255
      }
      return rgba
    })(),
  )

  summary.push({
    file: name,
    width: imageData.width,
    height: imageData.height,
    keepRatio: +(keep / pixels).toFixed(4),
    removeRatio: +(remove / pixels).toFixed(4),
    methodUsed: result.methodUsed,
    elapsedMs: result.elapsedMs,
  })
  console.log(
    `${name}: ${imageData.width}×${imageData.height} method=${result.methodUsed} keep=${((keep / pixels) * 100).toFixed(1)}% ${result.elapsedMs}ms`,
  )
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(`Wrote ${FIXTURES.length} results to ${outDir} (method=${method})`)
