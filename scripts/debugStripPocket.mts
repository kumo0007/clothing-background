import { createMaskBuffer } from '../src/lib/mask/createMask'
import { stripDarkWalledStudioPockets } from '../src/lib/mask/selectSimilar'

function makeImageData(
  width: number,
  height: number,
  fill: [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    data[o] = fill[0]
    data[o + 1] = fill[1]
    data[o + 2] = fill[2]
    data[o + 3] = 255
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData
}
function setRgb(
  image: ImageData,
  x: number,
  y: number,
  rgb: [number, number, number],
) {
  const o = (y * image.width + x) * 4
  image.data[o] = rgb[0]
  image.data[o + 1] = rgb[1]
  image.data[o + 2] = rgb[2]
}

const w = 40
const h = 40
const image = makeImageData(w, h, [229, 229, 229])
for (let y = 8; y < 28; y++) {
  for (let x = 8; x < 12; x++) setRgb(image, x, y, [24, 24, 24])
  for (let x = 28; x < 32; x++) setRgb(image, x, y, [24, 24, 24])
}
for (let x = 8; x < 32; x++) {
  for (let y = 8; y < 12; y++) setRgb(image, x, y, [24, 24, 24])
  for (let y = 24; y < 28; y++) setRgb(image, x, y, [24, 24, 24])
}
for (let y = 12; y < 24; y++) {
  for (let x = 12; x < 28; x++) setRgb(image, x, y, [248, 248, 248])
}
const mask = createMaskBuffer(w, h, 0)
for (let y = 8; y < 28; y++) {
  for (let x = 8; x < 12; x++) mask.data[y * w + x] = 255
  for (let x = 28; x < 32; x++) mask.data[y * w + x] = 255
}
for (let x = 8; x < 32; x++) {
  for (let y = 8; y < 12; y++) mask.data[y * w + x] = 255
  for (let y = 24; y < 28; y++) mask.data[y * w + x] = 255
}
for (let y = 12; y < 24; y++) {
  for (let x = 12; x < 28; x++) mask.data[y * w + x] = 255
}
const painted = stripDarkWalledStudioPockets(mask, image, 40)
console.log({ painted, hole: mask.data[18 * w + 20], wall: mask.data[18 * w + 9] })
