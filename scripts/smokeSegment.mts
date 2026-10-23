import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { runOpenCvAutoMask } from '../src/lib/mask/autoMaskPipeline'
import { shutdownOpenCvWorker } from '../src/lib/mask/opencv/segmentViaWorker'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = process.argv[2] ?? '08_sneakers.jpg'
const raw = readFileSync(join(root, 'public/testdata/clothing', file))
const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
const imageData = {
  width: d.width,
  height: d.height,
  data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
  colorSpace: 'srgb',
} as ImageData

console.log('fixture', file, d.width, 'x', d.height)
const keep = (m: Uint8ClampedArray) => {
  let n = 0
  for (let i = 0; i < m.length; i++) if (m[i]! >= 200) n++
  return n
}
const o = await runOpenCvAutoMask(imageData)
console.log('opencv', o.methodUsed, o.elapsedMs, 'ms keep', keep(o.mask.data))
shutdownOpenCvWorker()
