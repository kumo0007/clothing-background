/**
 * Halo diagnostics: mask + magenta/beige composites + edge crops.
 * Run: npx vite-node scripts/diagnoseHalos.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const outDir = join(root, 'tmp-halo-diagnostics')

const FILES = [
  '03_tshirt.jpg',
  '05_coat.jpg',
  '06_sweater.jpg',
  '07_dress.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
  '10_cap.jpg',
] as const

const MAGENTA: [number, number, number] = [255, 0, 255]
const BEIGE: [number, number, number] = [232, 220, 200]

function decode(path: string): ImageData {
  const d = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true })
  return {
    width: d.width,
    height: d.height,
    data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
    colorSpace: 'srgb',
  } as ImageData
}

function writePng(path: string, w: number, h: number, rgba: Uint8ClampedArray) {
  const png = new PNG({ width: w, height: h })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  writeFileSync(path, PNG.sync.write(png))
}

function fillBg(n: number, rgb: [number, number, number]) {
  const b = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    b[o] = rgb[0]
    b[o + 1] = rgb[1]
    b[o + 2] = rgb[2]
    b[o + 3] = 255
  }
  return b
}

function maskRgba(mask: Uint8ClampedArray, n: number) {
  const rgba = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const v = mask[i]!
    const o = i * 4
    rgba[o] = v
    rgba[o + 1] = v
    rgba[o + 2] = v
    rgba[o + 3] = 255
  }
  return rgba
}

function crop(
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
  scale = 4,
) {
  const out = new Uint8ClampedArray(cw * scale * ch * scale * 4)
  for (let y = 0; y < ch * scale; y++) {
    for (let x = 0; x < cw * scale; x++) {
      const sx = Math.min(srcW - 1, x0 + Math.floor(x / scale))
      const sy = Math.min(srcH - 1, y0 + Math.floor(y / scale))
      const si = (sy * srcW + sx) * 4
      const oi = (y * cw * scale + x) * 4
      out[oi] = rgba[si]!
      out[oi + 1] = rgba[si + 1]!
      out[oi + 2] = rgba[si + 2]!
      out[oi + 3] = 255
    }
  }
  return { w: cw * scale, h: ch * scale, data: out }
}

/** Proxy: KEEP pixels that are near-neutral and within studio distance of corners. */
function haloProxy(image: ImageData, mask: Uint8ClampedArray) {
  const corner = { r: 0, g: 0, b: 0 }
  // reuse average of 4 corners
  const pts = [
    [0, 0],
    [image.width - 1, 0],
    [0, image.height - 1],
    [image.width - 1, image.height - 1],
  ]
  for (const [x, y] of pts) {
    const o = (y! * image.width + x!) * 4
    corner.r += image.data[o]!
    corner.g += image.data[o + 1]!
    corner.b += image.data[o + 2]!
  }
  corner.r /= 4
  corner.g /= 4
  corner.b /= 4

  let keep = 0
  let studioKeepEdge = 0
  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      const i = y * image.width + x
      if (mask[i]! < 128) continue
      keep++
      const touchesRemove =
        mask[i - 1]! < 128 ||
        mask[i + 1]! < 128 ||
        mask[i - image.width]! < 128 ||
        mask[i + image.width]! < 128
      if (!touchesRemove) continue
      const o = i * 4
      const r = image.data[o]!
      const g = image.data[o + 1]!
      const b = image.data[o + 2]!
      const chroma = Math.max(r, g, b) - Math.min(r, g, b)
      const dr = r - corner.r
      const dg = g - corner.g
      const db = b - corner.b
      const d = Math.sqrt(dr * dr + dg * dg + db * db)
      const L = 0.299 * r + 0.587 * g + 0.114 * b
      if (chroma <= 22 && d <= 36 && L >= 170) studioKeepEdge++
    }
  }
  return {
    keep,
    studioKeepEdge,
    studioKeepEdgeRatio: keep === 0 ? 0 : studioKeepEdge / keep,
  }
}

mkdirSync(outDir, { recursive: true })
const summary = []

for (const name of FILES) {
  const image = decode(join(clothingDir, name))
  const { mask, methodUsed, elapsedMs } = await runAutoMaskPipeline(image, 'opencv')
  const n = image.width * image.height
  const base = name.replace(/\.jpg$/i, '')
  const magenta = compositePixelBuffers(image.data, mask.data, fillBg(n, MAGENTA))
  const beige = compositePixelBuffers(image.data, mask.data, fillBg(n, BEIGE))
  writePng(join(outDir, `${base}-source.png`), image.width, image.height, image.data)
  writePng(join(outDir, `${base}-mask.png`), image.width, image.height, maskRgba(mask.data, n))
  writePng(join(outDir, `${base}-magenta.png`), image.width, image.height, magenta)
  writePng(join(outDir, `${base}-beige.png`), image.width, image.height, beige)

  // Magnified crop: lower-center edge region
  const cw = Math.min(80, image.width)
  const ch = Math.min(60, image.height)
  const x0 = Math.max(0, ((image.width - cw) / 2) | 0)
  const y0 = Math.max(0, image.height - ch - 10)
  const cropMag = crop(magenta, image.width, image.height, x0, y0, cw, ch, 4)
  writePng(join(outDir, `${base}-edge-crop.png`), cropMag.w, cropMag.h, cropMag.data)

  const proxy = haloProxy(image, mask.data)
  summary.push({ file: name, methodUsed, elapsedMs, dims: `${image.width}x${image.height}`, ...proxy })
  console.log(
    `${name}: studioKeepEdge=${proxy.studioKeepEdge} (${(proxy.studioKeepEdgeRatio * 100).toFixed(2)}% of keep) ${elapsedMs}ms`,
  )
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log('Wrote', outDir)
