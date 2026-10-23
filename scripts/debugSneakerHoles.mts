import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { createMaskBuffer } from '../src/lib/mask/createMask'
import {
  featherMaskEdges,
  fillMaskHoles,
  morphCloseMask,
} from '../src/lib/mask/refineMask'
import {
  chokeMaskEdgeFringe,
  removeBrightEdgeChrome,
  removeSimilarToCorners,
  stripBorderConnectedStudio,
  stripEnclosedFlatStudio,
  stripForeignBorderBands,
} from '../src/lib/mask/selectSimilar'

const decoded = jpeg.decode(readFileSync('public/testdata/clothing/08_sneakers.jpg'), {
  useTArray: true,
  formatAsRGBA: true,
})
const image = {
  width: decoded.width,
  height: decoded.height,
  data: new Uint8ClampedArray(
    decoded.data.buffer,
    decoded.data.byteOffset,
    decoded.data.byteLength,
  ),
  colorSpace: 'srgb',
} as ImageData

function stats(label: string, mask: { data: Uint8Array; width: number; height: number }) {
  let keep = 0
  let remove = 0
  let brightKeep = 0
  let brightRemove = 0
  const { width: w, height: h, data } = mask
  for (let y = 40; y < h - 40; y++) {
    for (let x = 40; x < w - 40; x++) {
      const i = y * w + x
      const o = i * 4
      const L =
        0.299 * image.data[o]! +
        0.587 * image.data[o + 1]! +
        0.114 * image.data[o + 2]!
      if (data[i]! >= 200) {
        keep++
        if (L >= 220) brightKeep++
      } else if (data[i]! <= 20) {
        remove++
        if (L >= 220) brightRemove++
      }
    }
  }
  console.log(label, {
    keepPct: +((keep / (w * h)) * 100).toFixed(1),
    brightKeep,
    brightRemove,
  })
}

const mask = createMaskBuffer(image.width, image.height, 255)
removeSimilarToCorners(mask, image, 40)
stats('after removeSimilar', mask)
fillMaskHoles(mask)
stats('after fillHoles', mask)
morphCloseMask(mask, 1)
stats('after morphClose', mask)
stripBorderConnectedStudio(mask, image, 40)
stripEnclosedFlatStudio(mask, image, 40)
stats('after strip post-morph', mask)
chokeMaskEdgeFringe(mask, image, 40)
stats('after choke1', mask)
removeBrightEdgeChrome(mask, image)
stripForeignBorderBands(mask, image)
stripBorderConnectedStudio(mask, image, 40)
stripEnclosedFlatStudio(mask, image, 40)
chokeMaskEdgeFringe(mask, image, 40, { restoreTexture: true })
stats('after final choke+restore', mask)
stripForeignBorderBands(mask, image)
stripBorderConnectedStudio(mask, image, 40)
stripEnclosedFlatStudio(mask, image, 40)
featherMaskEdges(mask, 1)
stats('after feather', mask)
