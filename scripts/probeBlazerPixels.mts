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
const studioL =
  0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
let softStudio = 0
let hardStudio = 0
let hardDark = 0
let softOther = 0
const band = 40
for (let y = 0; y < img.height; y++) {
  for (let x = 0; x < img.width; x++) {
    const v = r.mask.data[y * img.width + x]!
    if (v < 20) continue
    const o = (y * img.width + x) * 4
    const R = img.data[o]!
    const G = img.data[o + 1]!
    const B = img.data[o + 2]!
    const L = 0.299 * R + 0.587 * G + 0.114 * B
    const dist = Math.hypot(R - corner.r, G - corner.g, B - corner.b)
    const nearBorder = x < band || y < band || x >= img.width - band || y >= img.height - band
    if (!nearBorder) continue
    if (dist < 35 && L > 180) {
      if (v >= 250) hardStudio++
      else softStudio++
    } else if (L < 80) {
      hardDark++
    } else if (v < 250) softOther++
  }
}
console.log({
  method: r.methodUsed,
  studioL: studioL.toFixed(1),
  corner,
  hardStudioNearBorder: hardStudio,
  softStudioNearBorder: softStudio,
  hardDarkNearBorder: hardDark,
  softOtherNearBorder: softOther,
})
