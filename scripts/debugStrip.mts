import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { createMaskBuffer } from '../src/lib/mask/createMask'
import {
  removeSimilarToCorners,
  stripForeignBorderBands,
} from '../src/lib/mask/selectSimilar'

function decode(path: string): ImageData {
  const decoded = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true })
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

for (const name of ['10_cap.jpg', '06_sweater.jpg', '08_sneakers.jpg']) {
  const image = decode(`public/testdata/clothing/${name}`)
  const mask = createMaskBuffer(image.width, image.height, 255)
  const painted = stripForeignBorderBands(mask, image)
  let bottomKeep = 0
  for (let y = image.height - 8; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (mask.data[y * image.width + x] === 255) bottomKeep++
    }
  }
  console.log(name, 'stripForeign painted', painted, 'bottom8 KEEP', bottomKeep)

  const full = createMaskBuffer(image.width, image.height, 255)
  removeSimilarToCorners(full, image, 40)
  bottomKeep = 0
  let midKeep = 0
  for (let y = image.height - 8; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (full.data[y * image.width + x] >= 200) bottomKeep++
    }
  }
  for (let y = 100; y < 150; y++) {
    for (let x = 100; x < 150; x++) {
      if (full.data[y * image.width + x] >= 200) midKeep++
    }
  }
  console.log(name, 'after full remove: bottom8 KEEP', bottomKeep, 'mid50 KEEP', midKeep)
}
