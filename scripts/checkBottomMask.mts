import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  '06_sweater.jpg',
  '07_dress.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
  '10_cap.jpg',
]

for (const name of files) {
  const d = jpeg.decode(
    readFileSync(join(root, 'public/testdata/clothing', name)),
    { useTArray: true, formatAsRGBA: true },
  )
  const image = {
    width: d.width,
    height: d.height,
    data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
    colorSpace: 'srgb',
  } as ImageData
  const { mask } = await runAutoMaskPipeline(image, 'opencv')
  console.log(`\n${name}`)
  for (let i = 0; i < 14; i++) {
    const y = d.height - 1 - i
    let soft = 0
    let hard = 0
    let zero = 0
    let maxV = 0
    for (let x = 0; x < d.width; x++) {
      const v = mask.data[y * d.width + x]!
      if (v === 0) zero++
      else if (v < 128) soft++
      else hard++
      if (v > maxV) maxV = v
    }
    console.log(
      `  y=${y} zero=${zero} soft=${soft} keep=${hard} max=${maxV}`,
    )
  }
}
