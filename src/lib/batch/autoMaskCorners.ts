import { loadHtmlImage } from '../image/loadHtmlImage'
import { getOrCreateMask, setMask } from '../mask/maskStore'
import {
  featherMaskEdges,
  fillMaskHoles,
  morphCloseMask,
} from '../mask/refineMask'
import {
  chokeMaskEdgeFringe,
  removeBrightEdgeChrome,
  removeSimilarToCorners,
  stripBorderConnectedStudio,
  stripEnclosedFlatStudio,
} from '../mask/selectSimilar'

/**
 * Auto-mask one image by keeping non-backdrop pixels (corner-color removal),
 * then Phase 6 cleanup: fill enclosed holes, close small gaps, strip edge chrome,
 * choke studio AA / soft-shadow fringe, and soft-feather over garment pixels.
 * Conventional color matching only — no AI.
 */
export async function autoMaskCornersForImage(
  imageId: string,
  objectUrl: string,
  width: number,
  height: number,
  tolerance = 40,
): Promise<void> {
  const image = await loadHtmlImage(objectUrl)
  const probe = document.createElement('canvas')
  probe.width = width
  probe.height = height
  const ctx = probe.getContext('2d')
  if (!ctx) {
    throw new Error('Could not read image pixels')
  }
  ctx.drawImage(image, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)

  const mask = getOrCreateMask(imageId, width, height)
  mask.data.fill(255)
  removeSimilarToCorners(mask, imageData, tolerance)
  // Logo/stripe interiors and seam cracks often remain as enclosed REMOVE.
  fillMaskHoles(mask)
  morphCloseMask(mask, 1)
  // Closing re-expands into white AA / soft shadow — choke again, then chrome.
  chokeMaskEdgeFringe(mask, imageData, tolerance)
  removeBrightEdgeChrome(mask, imageData)
  // Morph-close can reattach flat studio; strip border + enclosed card pockets.
  stripBorderConnectedStudio(mask, imageData, tolerance)
  stripEnclosedFlatStudio(mask, imageData, tolerance)
  // Final choke without texture restore — restore was reintroducing studio AA.
  chokeMaskEdgeFringe(mask, imageData, tolerance, { restoreTexture: false })
  stripBorderConnectedStudio(mask, imageData, tolerance)
  // Inward feather only — soft edges without raising REMOVE (studio) pixels.
  featherMaskEdges(mask, 2)
  setMask(imageId, mask)
}
