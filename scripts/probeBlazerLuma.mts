import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
import { averageCornerColor } from '../src/lib/mask/selectSimilar'

const d = jpeg.decode(readFileSync('public/testdata/clothing/02_blazer.jpg'), {
  useTArray: true,
  formatAsRGBA: true,
})
const img = {
  width: d.width,
  height: d.height,
  data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
  colorSpace: 'srgb',
} as ImageData
const r = await runAutoMaskPipeline(img, 'auto')
const corner = averageCornerColor(img)
const studioL = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
const hist = new Map<string, number>()
let samples = 0
for (let y = 0; y < img.height; y++) {
  for (let x = 0; x < img.width; x++) {
    if (x > 30 && y > 30 && x < img.width - 30 && y < img.height - 30) continue
    const v = r.mask.data[y * img.width + x]!
    if (v < 250) continue
    const o = (y * img.width + x) * 4
    const R = img.data[o]!
    const G = img.data[o + 1]!
    const B = img.data[o + 2]!
    const L = 0.299 * R + 0.587 * G + 0.114 * B
    if (L < 160) continue
    const dist = Math.hypot(R - corner.r, G - corner.g, B - corner.b)
    const bucket = `L${Math.round(L)} d${Math.round(dist)}`
    hist.set(bucket, (hist.get(bucket) ?? 0) + 1)
    samples++
  }
}
const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
console.log({ studioL, samples, top })
