import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { segmentGarmentBySeeds } from '../src/lib/mask/opencv/segmentSeeds'
import { createMaskBuffer } from '../src/lib/mask/createMask'
import { fillMaskHoles } from '../src/lib/mask/refineMask'
import { averageCornerColor } from '../src/lib/mask/selectSimilar'

const raw = readFileSync('public/testdata/clothing/08_sneakers.jpg')
const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
const imageData = {
  width: d.width,
  height: d.height,
  data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
  colorSpace: 'srgb',
} as ImageData
const corner = averageCornerColor(imageData)
const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
const seed = segmentGarmentBySeeds(imageData)
const mask = createMaskBuffer(d.width, d.height, 0)
mask.data.set(seed.mask.data)
fillMaskHoles(mask)

const w = d.width
const h = d.height
let paleKeep = 0
let paleNearDark = 0
let liftHist = [0, 0, 0, 0, 0] // <=0, <=1, <=2, <=4, >4
for (let y = 1; y < h - 1; y += 1) {
  for (let x = 1; x < w - 1; x += 1) {
    const i = y * w + x
    if (mask.data[i]! < 128) continue
    const o = i * 4
    const r = imageData.data[o]!
    const g = imageData.data[o + 1]!
    const b = imageData.data[o + 2]!
    const L = 0.299 * r + 0.587 * g + 0.114 * b
    const c = Math.max(r, g, b) - Math.min(r, g, b)
    if (L < studioLuma - 4 || c > 24) continue
    paleKeep += 1
    const lift = L - studioLuma
    if (lift <= 0) liftHist[0]! += 1
    else if (lift <= 1) liftHist[1]! += 1
    else if (lift <= 2) liftHist[2]! += 1
    else if (lift <= 4) liftHist[3]! += 1
    else liftHist[4]! += 1
    let dark = false
    for (const n of [i - 1, i + 1, i - w, i + w]) {
      if (mask.data[n]! < 128) continue
      const no = n * 4
      const nL =
        0.299 * imageData.data[no]! +
        0.587 * imageData.data[no + 1]! +
        0.114 * imageData.data[no + 2]!
      if (nL < 100) dark = true
    }
    if (dark) paleNearDark += 1
  }
}
console.log({
  studioLuma,
  paleKeep,
  paleNearDark,
  liftHist: {
    le0: liftHist[0],
    le1: liftHist[1],
    le2: liftHist[2],
    le4: liftHist[3],
    gt4: liftHist[4],
  },
})
