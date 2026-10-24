import { createMaskBuffer } from '../src/lib/mask/createMask.ts'
import { analyzeKeepComponents } from '../src/lib/mask/diagnostics/fragmentation.ts'

const w = 60
const h = 80
const mask = createMaskBuffer(w, h, 0)
for (let y = 40; y < 70; y += 1) {
  for (let x = 20; x < 40; x += 1) mask.data[y * w + x] = 255
}
for (let y = 15; y <= 40; y += 1) {
  mask.data[y * w + 29] = 255
  mask.data[y * w + 30] = 255
}
let keep = 0
for (const v of mask.data) if (v >= 128) keep += 1
console.log('keep', keep)
console.log(analyzeKeepComponents(mask).summary)
