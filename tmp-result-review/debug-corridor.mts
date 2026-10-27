import { createMaskBuffer } from '../src/lib/mask/createMask'
import {
  detectSdkUnderRecall,
  hasThinKeepCorridor,
  repairSdkUnderRecall,
} from '../src/lib/mask/sdkUnderRecallRepair'

function makeImage(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y)
      const o = (y * width + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = 255
    }
  }
  return new ImageData(data, width, height)
}

const w = 120
const h = 160
const shirt = { x0: 25, y0: 30, x1: 95, y1: 140 }
const tapeY0 = 80
const tapeY1 = 88
const image = makeImage(w, h, (x, y) => {
  const onShirt =
    x >= shirt.x0 && x <= shirt.x1 && y >= shirt.y0 && y <= shirt.y1
  const onTape = onShirt && y >= tapeY0 && y <= tapeY1
  if (onTape) return [40, 40, 40]
  if (onShirt) return [235, 235, 232]
  return [180, 165, 145]
})
const mask = createMaskBuffer(w, h, 0)
for (let y = shirt.y0; y <= shirt.y1; y += 1) {
  if (y >= tapeY0 && y <= tapeY1) continue
  for (let x = shirt.x0; x <= shirt.x1; x += 1) {
    mask.data[y * w + x] = 255
  }
}
const keep = mask.data.filter((v) => v >= 128).length
console.log({
  corridor: hasThinKeepCorridor(mask),
  detect: detectSdkUnderRecall(mask, image),
  keepRatio: keep / (w * h),
})
console.log(repairSdkUnderRecall(mask, image))
