/**
 * Per-stage mask diagnostics for failing clothing fixtures.
 * Run: npx vite-node scripts/diagnoseStages.mts
 */
import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { createMaskBuffer } from '../src/lib/mask/createMask'
import {
  featherMaskEdges,
  fillMaskHoles,
  morphCloseMask,
} from '../src/lib/mask/refineMask'
import {
  averageCornerColor,
  chokeMaskEdgeFringe,
  reclaimGarmentFromKeep,
  removeBrightEdgeChrome,
  removeSimilarToCorners,
  stripBorderConnectedStudio,
  stripEnclosedFlatStudio,
  stripForeignBorderBands,
} from '../src/lib/mask/selectSimilar'

const FIXTURES = [
  '05_coat.jpg',
  '07_dress.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
  '10_cap.jpg',
] as const

function decode(path: string): ImageData {
  const d = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true })
  return {
    width: d.width,
    height: d.height,
    data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
    colorSpace: 'srgb',
  } as ImageData
}

function stageStats(
  label: string,
  mask: { data: Uint8Array; width: number; height: number },
  image: ImageData,
) {
  const { width: w, height: h, data } = mask
  let keep = 0
  let remove = 0
  let partial = 0
  let brightKeep = 0
  let brightRemove = 0
  let bottomKeep = 0
  const bottomY0 = h - 12
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = data[i]!
      const o = i * 4
      const L =
        0.299 * image.data[o]! +
        0.587 * image.data[o + 1]! +
        0.114 * image.data[o + 2]!
      if (v >= 200) {
        keep++
        if (L >= 210) brightKeep++
        if (y >= bottomY0) bottomKeep++
      } else if (v <= 20) {
        remove++
        if (L >= 210) brightRemove++
      } else {
        partial++
      }
    }
  }
  const n = w * h
  console.log(
    `  ${label.padEnd(28)} keep=${((keep / n) * 100).toFixed(1)}% rem=${((remove / n) * 100).toFixed(1)}% part=${partial} brightK=${brightKeep} brightR=${brightRemove} botK=${bottomKeep}`,
  )
}

for (const name of FIXTURES) {
  const image = decode(`public/testdata/clothing/${name}`)
  const tol = 40
  const corner = averageCornerColor(image)
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  console.log(
    `\n=== ${name} ${image.width}x${image.height} studio≈${corner.r},${corner.g},${corner.b} L=${studioLuma.toFixed(1)} ===`,
  )

  const mask = createMaskBuffer(image.width, image.height, 255)
  removeSimilarToCorners(mask, image, tol)
  stageStats('after removeSimilar', mask, image)

  fillMaskHoles(mask)
  stageStats('after fillHoles', mask, image)

  morphCloseMask(mask, 1)
  stageStats('after morphClose', mask, image)

  reclaimGarmentFromKeep(
    mask,
    image,
    corner,
    Math.max(16, Math.floor(Math.min(image.width, image.height) / 8)),
    Math.max(14, Math.floor(tol * 0.45)),
  )
  stageStats('after reclaim1', mask, image)

  stripBorderConnectedStudio(mask, image, tol)
  stripEnclosedFlatStudio(mask, image, tol)
  stageStats('after strip post-reclaim', mask, image)

  chokeMaskEdgeFringe(mask, image, tol)
  stageStats('after choke1', mask, image)

  removeBrightEdgeChrome(mask, image)
  stripForeignBorderBands(mask, image)
  stripBorderConnectedStudio(mask, image, tol)
  stripEnclosedFlatStudio(mask, image, tol)
  stageStats('after chrome+foreign+strip', mask, image)

  chokeMaskEdgeFringe(mask, image, tol, { restoreTexture: true })
  stageStats('after choke+restore', mask, image)

  stripForeignBorderBands(mask, image)
  stripBorderConnectedStudio(mask, image, tol)
  stripEnclosedFlatStudio(mask, image, tol)
  reclaimGarmentFromKeep(
    mask,
    image,
    corner,
    Math.max(10, Math.floor(Math.min(image.width, image.height) / 12)),
    Math.max(14, Math.floor(tol * 0.45)),
  )
  stageStats('after reclaim2', mask, image)

  stripForeignBorderBands(mask, image)
  stripBorderConnectedStudio(mask, image, tol)
  stripEnclosedFlatStudio(mask, image, tol)
  featherMaskEdges(mask, 1)
  stageStats('after feather (final)', mask, image)
}
