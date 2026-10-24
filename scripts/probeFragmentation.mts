/**
 * Reproduce fragmentation metrics on dress fixture (Lab proxy + optional notes).
 * Explains what keepComponentCount actually counts.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { createMaskBuffer } from '../src/lib/mask/createMask.ts'
import { countKeepComponents } from '../src/lib/mask/diagnostics/maskMetrics.ts'
import { analyzeKeepComponents } from '../src/lib/mask/diagnostics/fragmentation.ts'
import { segmentImageLocally } from '../src/lib/mask/localSegment.ts'

const root = resolve(import.meta.dirname, '..')

function decodeJpeg(path: string) {
  const buf = readFileSync(path)
  const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
    colorSpace: 'srgb' as const,
  } as ImageData
}

function loadMaskPng(path: string) {
  const png = PNG.sync.read(readFileSync(path))
  const mask = createMaskBuffer(png.width, png.height, 0)
  for (let i = 0; i < mask.data.length; i += 1) {
    // grayscale mask exports store value in R (or luma)
    mask.data[i] = png.data[i * 4]!
  }
  return mask
}

const sources = [
  resolve(root, 'public/testdata/clothing/07_dress.jpg'),
  resolve(root, 'tmp-contour-diagnose/source/07_dress.jpg'),
]

const maskCandidates = [
  resolve(root, 'tmp-local-automask-audit/07_dress-mask.png'),
  resolve(root, 'tmp-halo-diagnostics/07_dress-mask.png'),
  resolve(root, 'tmp-quality-pass-exports/07_dress-mask.png'),
]

for (const src of sources) {
  if (!existsSync(src)) continue
  console.log('\n=== source', basename(src), '===')
  const image = decodeJpeg(src)
  console.log('dims', image.width, 'x', image.height)
  const seg = await segmentImageLocally(image, { tolerance: 40 })
  const legacy = countKeepComponents(seg.mask, 12)
  const analysis = analyzeKeepComponents(seg.mask)
  console.log('Lab-seed keep%', ((100 * seg.mask.data.filter((v) => v >= 128).length) / seg.mask.data.length).toFixed(1))
  console.log('legacy countKeepComponents(minSize=12)=', legacy.count, 'largestShare=', legacy.largestShare.toFixed(3))
  console.log(JSON.stringify(analysis.summary, null, 2))
}

for (const mp of maskCandidates) {
  if (!existsSync(mp)) continue
  console.log('\n=== mask png', mp.replace(root, '') , '===')
  const mask = loadMaskPng(mp)
  console.log('dims', mask.width, 'x', mask.height)
  const legacy = countKeepComponents(mask, 12)
  const analysis = analyzeKeepComponents(mask)
  console.log('legacy count(min12)=', legacy.count, 'largestShare=', legacy.largestShare.toFixed(3))
  console.log(JSON.stringify(analysis.summary, null, 2))
}
