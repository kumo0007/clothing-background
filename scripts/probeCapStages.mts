import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { segmentGarmentBySeeds } from '../src/lib/mask/opencv/segmentSeeds'
import { createMaskBuffer } from '../src/lib/mask/createMask'
import { fillMaskHoles, featherMaskEdges } from '../src/lib/mask/refineMask'
import { refineSilhouetteBoundary } from '../src/lib/mask/refineBoundary'
import {
  averageCornerColor,
  reclaimGarmentFromKeep,
  stripBorderConnectedStudio,
  stripEnclosedFlatStudio,
  stripOpenArchStudio,
  chokeBrightStudioBesideDark,
  stripDarkWalledStudioPockets,
  stripDetachedStudioIslands,
  chokeMaskEdgeFringe,
  removeBrightEdgeChrome,
  stripForeignBorderBands,
} from '../src/lib/mask/selectSimilar'

const raw = readFileSync('public/testdata/clothing/10_cap.jpg')
const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
const imageData = {
  width: d.width,
  height: d.height,
  data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
  colorSpace: 'srgb',
} as ImageData
const corner = averageCornerColor(imageData)
const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
const tol = 40
const w = imageData.width
const h = imageData.height

const seed = segmentGarmentBySeeds(imageData)
const mask = createMaskBuffer(w, h, 0)
mask.data.set(seed.mask.data)

const keep = () => [...mask.data].filter((v) => v >= 128).length
const topKeep = () => {
  let n = 0
  for (let x = 0; x < w; x += 1) if (mask.data[x]! >= 128) n += 1
  return n
}
const log = (label: string) =>
  console.log(label, 'keep', keep(), 'topRowKeep', topKeep())

log('seeds')
fillMaskHoles(mask)
log('fillHoles')
stripEnclosedFlatStudio(mask, imageData, tol)
log('stripEnclosed')
stripOpenArchStudio(mask, imageData, tol)
log('stripOpenArch')
chokeBrightStudioBesideDark(mask, imageData, tol)
log('choke')
stripDarkWalledStudioPockets(mask, imageData, tol)
log('darkWalled')
reclaimGarmentFromKeep(
  mask,
  imageData,
  corner,
  Math.max(16, Math.floor(Math.min(w, h) / 8)),
  Math.max(16, Math.floor(tol * 0.5)),
)
log('reclaim1')
stripBorderConnectedStudio(mask, imageData, tol)
log('stripBorder1')
stripEnclosedFlatStudio(mask, imageData, tol)
log('stripEnclosed2')
stripOpenArchStudio(mask, imageData, tol)
log('openArch2')
chokeBrightStudioBesideDark(mask, imageData, tol)
log('choke2')
stripDarkWalledStudioPockets(mask, imageData, tol)
log('darkWalled2')
stripDetachedStudioIslands(mask, imageData, tol)
log('detached')
chokeMaskEdgeFringe(mask, imageData, tol, { restoreTexture: true })
log('chokeFringe')
removeBrightEdgeChrome(mask, imageData)
log('chrome')
stripForeignBorderBands(mask, imageData)
log('foreign')
stripBorderConnectedStudio(mask, imageData, tol)
log('stripBorder2')
refineSilhouetteBoundary(mask, imageData, tol)
log('refine')
reclaimGarmentFromKeep(
  mask,
  imageData,
  corner,
  Math.max(12, Math.floor(Math.min(w, h) / 10)),
  Math.max(12, Math.floor(tol * 0.4)),
)
log('reclaimFinal')
stripBorderConnectedStudio(mask, imageData, tol)
log('stripBorderFinal')
featherMaskEdges(mask, 1)
log('feather')
console.log('studioLuma', studioLuma, 'corner', corner)
