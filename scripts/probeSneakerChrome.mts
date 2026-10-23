import { readFileSync } from "node:fs"
import jpeg from "jpeg-js"
import { segmentGarmentBySeeds } from "../src/lib/mask/opencv/segmentSeeds"
import { createMaskBuffer } from "../src/lib/mask/createMask"
import { fillMaskHoles } from "../src/lib/mask/refineMask"
import {
  averageCornerColor, stripEnclosedFlatStudio, removeBrightEdgeChrome,
  stripForeignBorderBands, stripBorderConnectedStudio, reclaimGarmentFromKeep,
} from "../src/lib/mask/selectSimilar"

const raw = readFileSync("public/testdata/clothing/08_sneakers.jpg")
const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
const imageData = {
  width: d.width, height: d.height,
  data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
  colorSpace: "srgb",
} as ImageData
const corner = averageCornerColor(imageData)
const studioLuma = 0.299*corner.r+0.587*corner.g+0.114*corner.b
const seed = segmentGarmentBySeeds(imageData)
const mask = createMaskBuffer(d.width, d.height, 0)
mask.data.set(seed.mask.data)
const pale = () => {
  let n=0
  for (let i=0;i<mask.data.length;i++) {
    if (mask.data[i]<128) continue
    const o=i*4
    const L=0.299*imageData.data[o]+0.587*imageData.data[o+1]+0.114*imageData.data[o+2]
    const c=Math.max(imageData.data[o],imageData.data[o+1],imageData.data[o+2])-Math.min(imageData.data[o],imageData.data[o+1],imageData.data[o+2])
    if (L>=studioLuma-4 && c<=24) n++
  }
  return n
}
fillMaskHoles(mask)
console.log("after fill", pale())
stripEnclosedFlatStudio(mask, imageData, 40)
console.log("after enclosed", pale())
const beforeChrome = pale()
const painted = removeBrightEdgeChrome(mask, imageData)
console.log("chrome painted", painted, "pale", pale(), "before", beforeChrome)
