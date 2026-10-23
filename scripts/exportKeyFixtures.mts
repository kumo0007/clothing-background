/** Faster re-export of the critical clothing fixtures only. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'tmp-quality-pass-exports')
const FIXTURES = [
  '06_sweater.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
  '10_cap.jpg',
] as const

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

mkdirSync(outDir, { recursive: true })
const BG: [number, number, number] = [255, 0, 255]

for (const name of FIXTURES) {
  const imageData = decodeJpeg(join(root, 'public/testdata/clothing', name))
  const { mask, methodUsed, elapsedMs } = await runAutoMaskPipeline(
    imageData,
    'opencv',
  )
  const pixels = imageData.width * imageData.height
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
  const maskRgba = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i += 1) {
    const v = mask.data[i]!
    const o = i * 4
    maskRgba[o] = v
    maskRgba[o + 1] = v
    maskRgba[o + 2] = v
    maskRgba[o + 3] = 255
  }
  writePng(join(outDir, `${base}-mask.png`), imageData.width, imageData.height, maskRgba)
  console.log(`${name}: ${methodUsed} ${elapsedMs}ms`)
}
