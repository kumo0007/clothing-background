import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { segmentGarmentWithIsnetNode } from '../src/lib/mask/model/isnetSegment'

const raw = readFileSync('public/testdata/clothing/08_sneakers.jpg')
const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
const imageData = {
  width: d.width,
  height: d.height,
  data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
  colorSpace: 'srgb',
} as ImageData

console.log('Running ISNet medium on sneakers…')
const result = await segmentGarmentWithIsnetNode(
  imageData,
  'medium',
  'public/testdata/clothing/08_sneakers.jpg',
)
let keep = 0
let soft = 0
for (let i = 0; i < result.mask.data.length; i++) {
  const v = result.mask.data[i]!
  if (v >= 128) keep++
  if (v > 0 && v < 255) soft++
}
console.log({
  methodUsed: result.methodUsed,
  modelId: result.modelId,
  genuine: result.genuineModelInference,
  elapsedMs: result.elapsedMs,
  keep,
  soft,
  runtime: result.runtime,
})
