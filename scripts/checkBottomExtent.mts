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
  let firstKeepFromBottom = -1
  for (let y = d.height - 1; y >= 0; y--) {
    let keep = 0
    for (let x = 0; x < d.width; x++) {
      if (mask.data[y * d.width + x]! > 0) keep++
    }
    if (keep > 0) {
      firstKeepFromBottom = y
      console.log(
        `${name}: first non-zero mask row from bottom y=${y} (inset=${d.height - 1 - y}px) nonzero=${keep}`,
      )
      break
    }
  }
  if (firstKeepFromBottom < 0) console.log(`${name}: entire mask empty?!`)
}
