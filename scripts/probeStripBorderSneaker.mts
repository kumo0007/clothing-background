import { readFileSync } from "node:fs"
import jpeg from "jpeg-js"
import { segmentGarmentBySeeds } from "../src/lib/mask/opencv/segmentSeeds"
import { stripBorderConnectedStudio, averageCornerColor } from "../src/lib/mask/selectSimilar"
import { createMaskBuffer } from "../src/lib/mask/createMask"

const raw = readFileSync("public/testdata/clothing/08_sneakers.jpg")
const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
const imageData = {
  width: d.width, height: d.height,
  data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
  colorSpace: "srgb",
}
const seed = segmentGarmentBySeeds(imageData as ImageData)
const before = seed.mask.data.reduce((a,v)=>a+(v>=128?1:0),0)
const painted = stripBorderConnectedStudio(seed.mask, imageData as ImageData, 40)
const after = seed.mask.data.reduce((a,v)=>a+(v>=128?1:0),0)
const corner = averageCornerColor(imageData as ImageData)
const studio = 0.299*corner.r+0.587*corner.g+0.114*corner.b
let paleKeep=0, paleRemove=0
for (let i=0;i<seed.mask.data.length;i++) {
  const o=i*4
  const L=0.299*imageData.data[o]+0.587*imageData.data[o+1]+0.114*imageData.data[o+2]
  const c=Math.max(imageData.data[o],imageData.data[o+1],imageData.data[o+2])-Math.min(imageData.data[o],imageData.data[o+1],imageData.data[o+2])
  if (L>=studio-4 && c<=24) {
    if (seed.mask.data[i]>=128) paleKeep++; else paleRemove++
  }
}
console.log({ before, painted, after, paleKeep, paleRemove, studio:+studio.toFixed(1) })
