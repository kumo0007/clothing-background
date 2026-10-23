/**
 * Probe why studio remains KEEP on blazer/jeans/hoodie.
 * Run: npx vite-node scripts/probeFalseFg.mts
 */
import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { segmentGarmentBySeeds } from '../src/lib/mask/opencv/segmentSeeds'
import { cloneMaskBuffer } from '../src/lib/mask/createMask'
import {
  averageCornerColor,
  chokeBrightStudioBesideDark,
  chokeMaskEdgeFringe,
  reclaimGarmentFromKeep,
  removeBrightEdgeChrome,
  stripBorderConnectedStudio,
  stripBorderTouchingStudioComponents,
  stripDarkWalledStudioPockets,
  stripDetachedStudioIslands,
  stripEnclosedFlatStudio,
  stripForeignBorderBands,
  stripOpenArchStudio,
} from '../src/lib/mask/selectSimilar'
import { applyPaleCompetition } from '../src/lib/mask/paleCompetition'
import { fillMaskHoles } from '../src/lib/mask/refineMask'
import { refineSilhouetteBoundary } from '../src/lib/mask/refineBoundary'
import { featherMaskEdges } from '../src/lib/mask/refineMask'
import type { MaskPixelBuffer } from '../src/types/mask'

function decode(path: string): ImageData {
  const d = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true })
  return {
    width: d.width,
    height: d.height,
    data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
    colorSpace: 'srgb',
  } as ImageData
}

function stats(label: string, mask: MaskPixelBuffer, img: ImageData) {
  const { width: w, height: h, data } = mask
  let keep = 0
  let borderKeep = 0
  let borderN = 0
  let brightKeep = 0
  const band = 8
  const corner = averageCornerColor(img)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x
      const v = data[i]!
      if (v < 128) continue
      keep += 1
      const o = i * 4
      const L =
        0.299 * img.data[o]! + 0.587 * img.data[o + 1]! + 0.114 * img.data[o + 2]!
      if (L > 200) brightKeep += 1
      const onBorder =
        x < band || y < band || x >= w - band || y >= h - band
      if (onBorder) {
        borderN += 1
        borderKeep += 1
      }
    }
  }
  // recount borderN properly
  borderN = 0
  borderKeep = 0
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (x >= band && y >= band && x < w - band && y < h - band) continue
      borderN += 1
      if (data[y * w + x]! >= 128) borderKeep += 1
    }
  }
  console.log(
    `  ${label.padEnd(28)} keep=${keep} brightKeep=${brightKeep} borderKeep%=${((100 * borderKeep) / borderN).toFixed(1)} corner≈${corner.r},${corner.g},${corner.b}`,
  )
}

const names = ['01_hoodie.jpg', '02_blazer.jpg', '04_jeans.jpg', '03_tshirt.jpg']
const tol = 40

for (const name of names) {
  const img = decode(`public/testdata/clothing/${name}`)
  console.log(`\n=== ${name} ===`)
  const seed = segmentGarmentBySeeds(img)
  const mask = cloneMaskBuffer(seed.mask)
  stats('after seed', mask, img)

  fillMaskHoles(mask)
  stats('after fillHoles', mask, img)
  applyPaleCompetition(mask, img)
  stats('after pale1', mask, img)
  stripEnclosedFlatStudio(mask, img, tol)
  stripOpenArchStudio(mask, img, tol)
  chokeBrightStudioBesideDark(mask, img, tol)
  stripDarkWalledStudioPockets(mask, img, tol)
  stats('after enclosed/arch', mask, img)
  const corner = averageCornerColor(img)
  reclaimGarmentFromKeep(
    mask,
    img,
    corner,
    Math.max(16, Math.floor(Math.min(img.width, img.height) / 8)),
    Math.max(16, Math.floor(tol * 0.5)),
  )
  stats('after reclaim', mask, img)
  stripBorderConnectedStudio(mask, img, tol)
  stats('after borderStudio', mask, img)
  stripBorderTouchingStudioComponents(mask, img, tol)
  stats('after borderStudioComp', mask, img)
  stripDetachedStudioIslands(mask, img, tol)
  stats('after detachedIslands', mask, img)
  stripForeignBorderBands(mask, img)
  stats('after foreignBands', mask, img)
  removeBrightEdgeChrome(mask, img)
  chokeMaskEdgeFringe(mask, img, tol, { restoreTexture: true })
  stripBorderConnectedStudio(mask, img, tol)
  stripBorderTouchingStudioComponents(mask, img, tol)
  stripDetachedStudioIslands(mask, img, tol)
  stripForeignBorderBands(mask, img)
  refineSilhouetteBoundary(mask, img, tol)
  stripForeignBorderBands(mask, img)
  stripBorderTouchingStudioComponents(mask, img, tol)
  stripDetachedStudioIslands(mask, img, tol)
  featherMaskEdges(mask, 1)
  stats('after full-ish cleanup', mask, img)
}
