import type { BrushMode, MaskPixelBuffer } from '../../types/mask'
import { markCompetitionProtectedPale } from './paleCompetition'

export type Rgb = { r: number; g: number; b: number }

function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function readRgb(imageData: ImageData, x: number, y: number): Rgb {
  const offset = (y * imageData.width + x) * 4
  return {
    r: imageData.data[offset],
    g: imageData.data[offset + 1],
    b: imageData.data[offset + 2],
  }
}

function brushValue(mode: BrushMode): number {
  return mode === 'keep' ? 255 : 0
}

function luminanceAt(imageData: ImageData, x: number, y: number): number {
  const offset = (y * imageData.width + x) * 4
  const r = imageData.data[offset]
  const g = imageData.data[offset + 1]
  const b = imageData.data[offset + 2]
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** 5×5 luma variance — flat studio backdrops are near zero; garments are higher. */
export function localLumaVariance(
  imageData: ImageData,
  x: number,
  y: number,
  radius = 2,
): number {
  const width = imageData.width
  const height = imageData.height
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let dy = -radius; dy <= radius; dy += 1) {
    const yy = Math.min(height - 1, Math.max(0, y + dy))
    for (let dx = -radius; dx <= radius; dx += 1) {
      const xx = Math.min(width - 1, Math.max(0, x + dx))
      const value = luminanceAt(imageData, xx, yy)
      sum += value
      sumSq += value * value
      count += 1
    }
  }
  const mean = sum / count
  return sumSq / count - mean * mean
}

/**
 * Paint mask from a seed pixel using connected color similarity (flood fill).
 * Conventional CV — not AI. Only updates the mask; original pixels unchanged.
 */
export function floodSelectSimilar(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number,
  mode: BrushMode,
): number {
  const width = mask.width
  const height = mask.height
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(seedX)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(seedY)))
  const target = readRgb(imageData, x0, y0)
  const value = brushValue(mode)
  const visited = new Uint8Array(width * height)
  const stack: number[] = [y0 * width + x0]
  let painted = 0

  while (stack.length > 0) {
    const index = stack.pop()!
    if (visited[index]) {
      continue
    }
    visited[index] = 1

    const x = index % width
    const y = (index / width) | 0
    const rgb = readRgb(imageData, x, y)
    if (colorDistance(rgb, target) > tolerance) {
      continue
    }

    mask.data[index] = value
    painted += 1

    if (x > 0) {
      stack.push(index - 1)
    }
    if (x + 1 < width) {
      stack.push(index + 1)
    }
    if (y > 0) {
      stack.push(index - width)
    }
    if (y + 1 < height) {
      stack.push(index + width)
    }
  }

  return painted
}

/**
 * Global (non-connected) select-similar: every pixel within tolerance of the
 * sampled color is painted. Useful for flat product illustrations.
 */
export function globalSelectSimilar(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number,
  mode: BrushMode,
): number {
  const width = mask.width
  const height = mask.height
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(seedX)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(seedY)))
  const target = readRgb(imageData, x0, y0)
  const value = brushValue(mode)
  let painted = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rgb = readRgb(imageData, x, y)
      if (colorDistance(rgb, target) <= tolerance) {
        mask.data[y * width + x] = value
        painted += 1
      }
    }
  }

  return painted
}

/** Catalog chrome / JPEG blowout — include ~230–241 strips jeans/bags leave. */
const CHROME_LUMA = 232
/** Flat studio cards are smooth; garment fabric / busy CGI usually sits above this. */
const STUDIO_MAX_VARIANCE = 12

function isNearNeutral(rgb: Rgb, maxChroma = 18): boolean {
  return Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) <= maxChroma
}

/** Slightly looser neutral for JPEG white AA that picks up a faint color cast. */
function isNearNeutralBright(rgb: Rgb): boolean {
  return isNearNeutral(rgb, 32)
}

type BorderSample = { x: number; y: number; rgb: Rgb; luma: number }

/**
 * Walk a thin border ring and collect flat, non-chrome pixels. Used when the
 * garment fills the frame and inset "corners" land on fabric instead of studio.
 */
function collectBorderFlatSamples(imageData: ImageData): BorderSample[] {
  const width = imageData.width
  const height = imageData.height
  const ring = Math.max(2, Math.floor(Math.min(width, height) * 0.04))
  const samples: BorderSample[] = []

  const consider = (x: number, y: number) => {
    const rgb = readRgb(imageData, x, y)
    const luma = luminanceAt(imageData, x, y)
    if (luma >= CHROME_LUMA) {
      return
    }
    // Scraped catalog UI (blue progress bars) must not poison studio color.
    const chroma = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
    if (chroma > 22) {
      return
    }
    if (localLumaVariance(imageData, x, y) > STUDIO_MAX_VARIANCE) {
      return
    }
    samples.push({ x, y, rgb, luma })
  }

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < ring; y += 1) {
      consider(x, y)
    }
    for (let y = height - ring; y < height; y += 1) {
      consider(x, y)
    }
  }
  for (let y = ring; y < height - ring; y += 1) {
    for (let x = 0; x < ring; x += 1) {
      consider(x, y)
    }
    for (let x = width - ring; x < width; x += 1) {
      consider(x, y)
    }
  }
  return samples
}

/**
 * Estimate studio backdrop color from flat border pixels.
 * Prefers the lighter mode when both light card and dark garment touch the edge
 * (common for fill-the-frame product crops like puffers).
 */
export function averageCornerColor(imageData: ImageData): Rgb {
  const samples = collectBorderFlatSamples(imageData)
  if (samples.length === 0) {
    return readRgb(imageData, 2, 2)
  }

  // Quantize luma into buckets; pick the most populous, preferring lighter ties.
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  for (const sample of samples) {
    const key = Math.round(sample.luma / 8) * 8
    const current = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    current.count += 1
    current.r += sample.rgb.r
    current.g += sample.rgb.g
    current.b += sample.rgb.b
    buckets.set(key, current)
  }

  const pickBest = (
    entries: Array<[number, { count: number; r: number; g: number; b: number }]>,
  ) => {
    let bestKey = -1
    let bestCount = -1
    for (const [key, bucket] of entries) {
      if (
        bucket.count > bestCount ||
        (bucket.count === bestCount && key > bestKey)
      ) {
        bestKey = key
        bestCount = bucket.count
      }
    }
    return buckets.get(bestKey)!
  }

  // Fill-frame garments (puffers) dominate the border with dark fabric. Prefer
  // a light studio-card bucket when enough flat light samples exist.
  const lightMin = Math.max(12, Math.floor(samples.length * 0.04))
  const lightEntries = [...buckets.entries()].filter(
    ([key, bucket]) => key >= 160 && bucket.count >= lightMin,
  )
  const best =
    lightEntries.length > 0 ? pickBest(lightEntries) : pickBest([...buckets.entries()])
  return {
    r: Math.round(best.r / best.count),
    g: Math.round(best.g / best.count),
    b: Math.round(best.b / best.count),
  }
}

/** Build flood seeds on flat border pixels that match the studio color. */
function backdropFloodSeeds(
  imageData: ImageData,
  studio: Rgb,
  tolerance: number,
): Array<[number, number]> {
  const width = imageData.width
  const height = imageData.height
  const samples = collectBorderFlatSamples(imageData)
  const seeds: Array<[number, number]> = []

  const pushUnique = (x: number, y: number) => {
    if (!seeds.some(([sx, sy]) => sx === x && sy === y)) {
      seeds.push([x, y])
    }
  }

  for (const sample of samples) {
    if (colorDistance(sample.rgb, studio) > tolerance) {
      continue
    }
    // Keep seed density modest — a few per edge is enough.
    if (
      sample.x === 0 ||
      sample.y === 0 ||
      sample.x === width - 1 ||
      sample.y === height - 1 ||
      sample.x % 7 === 0 ||
      sample.y % 7 === 0
    ) {
      pushUnique(sample.x, sample.y)
    }
  }

  // Guaranteed fallbacks near each side midpoint.
  const midX = Math.floor(width / 2)
  const midY = Math.floor(height / 2)
  const ring = Math.max(2, Math.floor(Math.min(width, height) * 0.04))
  for (let inset = 0; inset < ring; inset += 1) {
    const candidates: Array<[number, number]> = [
      [midX, inset],
      [midX, height - 1 - inset],
      [inset, midY],
      [width - 1 - inset, midY],
      [inset, inset],
      [width - 1 - inset, inset],
      [inset, height - 1 - inset],
      [width - 1 - inset, height - 1 - inset],
    ]
    for (const [x, y] of candidates) {
      if (luminanceAt(imageData, x, y) >= CHROME_LUMA) {
        continue
      }
      if (localLumaVariance(imageData, x, y) > STUDIO_MAX_VARIANCE) {
        continue
      }
      if (colorDistance(readRgb(imageData, x, y), studio) <= tolerance) {
        pushUnique(x, y)
      }
    }
  }

  if (seeds.length === 0) {
    pushUnique(2, 2)
    pushUnique(width - 3, 2)
    pushUnique(2, height - 3)
    pushUnique(width - 3, height - 3)
  }
  return seeds
}

/**
 * True when a pixel is bright garment fabric relative to the studio card.
 * White tees / sneaker leather sit above a gray card. On near-white cards the
 * classic luma margin fails — also protect micro-textured bright neutrals
 * (leather/suede weave) so sneakers are not flood-erased.
 */
function isBrighterThanStudio(
  rgb: Rgb,
  luma: number,
  studioLuma: number,
  margin = 12,
  variance = 0,
): boolean {
  if (!isNearNeutralBright(rgb) || luma < 200) {
    return false
  }
  // Gray / mid studio card: whites clearly above the card are garment.
  if (studioLuma < 218) {
    // Texture helps when the lift is modest (sneaker leather ≈ card + 6–10).
    if (variance > 12 && luma >= studioLuma + 6) {
      return true
    }
    return luma >= Math.max(studioLuma + margin, 226)
  }
  // Near-white studio: same-card / +1 band is never garment (estimate noise +
  // hem adjacency). Flat leather at card+3–4 must count as garment for flood
  // gates; reclaim separately refuses near-card neutrals so blazer slabs do
  // not grow back from dark hems via inflated edge variance.
  if (luma <= studioLuma + 1) {
    return false
  }
  if (variance > 20 && luma >= studioLuma + 2) {
    return true
  }
  return luma >= studioLuma + 3
}

/** Bright-garment gate that samples local variance at the pixel. */
function isBrightGarmentAt(
  imageData: ImageData,
  x: number,
  y: number,
  studioLuma: number,
): boolean {
  const rgb = readRgb(imageData, x, y)
  const luma = luminanceAt(imageData, x, y)
  const variance = localLumaVariance(imageData, x, y)
  return isBrighterThanStudio(rgb, luma, studioLuma, 12, variance)
}

/**
 * Warm mid-tone fabric (beige hoodie / camel coat) can sit within RGB tolerance
 * of a gray studio card. Never flood-remove those — product must stay intact.
 */
function isWarmGarmentFabric(rgb: Rgb, luma: number): boolean {
  const chroma =
    Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
  // Require clear warmth — chroma 12 matched warm studio cards and blocked
  // flood-remove of the entire backdrop in beige-on-beige product shots.
  return rgb.r > rgb.b + 12 && chroma >= 16 && luma >= 130 && luma <= 220
}

/**
 * Backdrop-remove flood that refuses to walk into bright garment fabric.
 * Plain floodSelectSimilar with tolerance 40 tunnels from gray card into white
 * tees/sneakers because RGB distance stays under tolerance across the AA ramp.
 */
function floodRemoveBackdrop(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number,
  studioLuma: number,
): number {
  const width = mask.width
  const height = mask.height
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(seedX)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(seedY)))
  const target = readRgb(imageData, x0, y0)
  const visited = new Uint8Array(width * height)
  const stack: number[] = [y0 * width + x0]
  let painted = 0

  while (stack.length > 0) {
    const index = stack.pop()!
    if (visited[index]) {
      continue
    }
    visited[index] = 1

    const x = index % width
    const y = (index / width) | 0
    const rgb = readRgb(imageData, x, y)
    const dist = colorDistance(rgb, target)
    if (dist > tolerance) {
      continue
    }
    const luma = luminanceAt(imageData, x, y)
    // Never flood-remove bright neutrals above the studio card — RGB distance
    // from white leather to gray card is often tiny (sneakers), so a distance
    // gate alone still eats the garment. Edge AA is handled by shallow choke.
    if (isBrightGarmentAt(imageData, x, y, studioLuma)) {
      continue
    }
    if (isWarmGarmentFabric(rgb, luma)) {
      continue
    }

    mask.data[index] = 0
    painted += 1

    if (x > 0) {
      stack.push(index - 1)
    }
    if (x + 1 < width) {
      stack.push(index + 1)
    }
    if (y > 0) {
      stack.push(index - width)
    }
    if (y + 1 < height) {
      stack.push(index + width)
    }
  }

  return painted
}

/**
 * Remove flat studio pixels that match the corner color anywhere in the image.
 * Recovers backdrop regions isolated by chrome strips. Textured garment pixels
 * (even light ones) are left for restoreTexturedKeeps / reclaim. Bright flat
 * whites above the studio card are protected (tees / sneaker panels).
 */
function removeFlatStudioBackdrop(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  corner: Rgb,
  tolerance: number,
  // JPEG card noise often sits above 5; 12 still spares woven fabric.
  maxVariance = 12,
): number {
  const width = mask.width
  const height = mask.height
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  let painted = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (mask.data[index] === 0) {
        continue
      }
      const rgb = readRgb(imageData, x, y)
      if (colorDistance(rgb, corner) > tolerance) {
        continue
      }
      const luma = luminanceAt(imageData, x, y)
      const variance = localLumaVariance(imageData, x, y)
      if (isBrighterThanStudio(rgb, luma, studioLuma, 12, variance)) {
        continue
      }
      if (isWarmGarmentFabric(rgb, luma)) {
        continue
      }
      // Near-white studio cards: global flat wipe destroys white sneakers/tees.
      // Leave bright neutrals for border-connected strip only.
      if (
        studioLuma >= 218 &&
        isNearNeutralBright(rgb) &&
        luma >= 210
      ) {
        continue
      }
      if (variance > maxVariance) {
        continue
      }
      mask.data[index] = 0
      painted += 1
    }
  }
  return painted
}

/**
 * After corner flood-remove, restore KEEP on textured pixels that were eaten
 * because they matched the studio color (typical for white garments).
 */
function restoreTexturedKeeps(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  textureKeepVariance: number,
): number {
  const width = mask.width
  const height = mask.height
  let restored = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (mask.data[index] !== 0) {
        continue
      }
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) {
        continue
      }
      if (localLumaVariance(imageData, x, y) <= textureKeepVariance) {
        continue
      }

      const rgb = readRgb(imageData, x, y)
      const luma = luminanceAt(imageData, x, y)
      const neutral = isNearNeutral(rgb)
      const touchesRemove =
        (x > 0 && mask.data[index - 1] === 0) ||
        (x + 1 < width && mask.data[index + 1] === 0) ||
        (y > 0 && mask.data[index - width] === 0) ||
        (y + 1 < height && mask.data[index + width] === 0)

      // Never put flat bright card AA back on the silhouette. Textured bright
      // neutrals (sneaker leather / tee weave) at the edge must still restore.
      if (
        touchesRemove &&
        luma >= 220 &&
        isNearNeutralBright(rgb) &&
        localLumaVariance(imageData, x, y) <= 8
      ) {
        continue
      }

      // Isolated studio fringe next to dark garments must stay REMOVE even when
      // edge variance is high. Only restore when attached to a light keep body
      // (white/beige fabric) or the pixel is clearly chromatic garment.
      if (neutral && luma >= 80) {
        let brightKeepNeighbor = false
        const neighbors = [
          index - 1,
          index + 1,
          index - width,
          index + width,
        ]
        for (const neighbor of neighbors) {
          if (neighbor < 0 || neighbor >= mask.data.length) {
            continue
          }
          if (mask.data[neighbor] !== 255) {
            continue
          }
          const nx = neighbor % width
          const ny = (neighbor / width) | 0
          const neighborLuma = luminanceAt(imageData, nx, ny)
          const threshold = luma >= 220 ? 200 : 140
          if (neighborLuma >= threshold) {
            brightKeepNeighbor = true
            break
          }
        }
        if (!brightKeepNeighbor) {
          continue
        }
      }

      mask.data[index] = 255
      restored += 1
    }
  }
  return restored
}

function touchesKeep(
  mask: MaskPixelBuffer,
  index: number,
  width: number,
  height: number,
): boolean {
  const x = index % width
  const y = (index / width) | 0
  if (x > 0 && mask.data[index - 1] === 255) {
    return true
  }
  if (x + 1 < width && mask.data[index + 1] === 255) {
    return true
  }
  if (y > 0 && mask.data[index - width] === 255) {
    return true
  }
  if (y + 1 < height && mask.data[index + width] === 255) {
    return true
  }
  return false
}

/**
 * Grow KEEP into neighboring REMOVE pixels that do not look like flat studio
 * backdrop. Recovers light garments (beige caps, white shirts) around logos /
 * seams that survived the corner flood.
 */
export function reclaimGarmentFromKeep(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  corner: Rgb,
  iterations: number,
  backdropTolerance: number,
): number {
  const width = mask.width
  const height = mask.height
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  let restored = 0

  for (let iter = 0; iter < iterations; iter += 1) {
    const next = new Uint8Array(mask.data)
    let gained = 0
    for (let y = 2; y < height - 2; y += 1) {
      for (let x = 2; x < width - 2; x += 1) {
        const index = y * width + x
        if (mask.data[index] !== 0) {
          continue
        }
        if (!touchesKeep(mask, index, width, height)) {
          continue
        }
        const rgb = readRgb(imageData, x, y)
        const luma = luminanceAt(imageData, x, y)
        const variance = localLumaVariance(imageData, x, y)
        // Bright white fabric above the studio card is garment even when RGB
        // distance to gray is small (tees / sneaker panels). Grow from a bright
        // KEEP body, or from dark accents (soles/logos) when the pixel is
        // textured / semi-interior — never from a lone dark edge into flat AA.
        // Near-white card: also reclaim modest lifts (+2) that failed the
        // brighter-than-studio gate due to low variance (flat leather panels).
        const nearWhiteLeather =
          studioLuma >= 218 &&
          isNearNeutralBright(rgb) &&
          luma >= studioLuma + 3 &&
          luma < 250
        if (isBrighterThanStudio(rgb, luma, studioLuma, 12, variance) || nearWhiteLeather) {
          let brightKeepNeighbor = false
          let darkKeepNeighbor = false
          let keepNeighbors = 0
          for (const neighbor of [
            index - 1,
            index + 1,
            index - width,
            index + width,
          ]) {
            if (neighbor < 0 || neighbor >= mask.data.length) {
              continue
            }
            if (mask.data[neighbor] !== 255) {
              continue
            }
            keepNeighbors += 1
            const nx = neighbor % width
            const ny = (neighbor / width) | 0
            if (luminanceAt(imageData, nx, ny) >= 200) {
              brightKeepNeighbor = true
            } else if (luminanceAt(imageData, nx, ny) < 120) {
              darkKeepNeighbor = true
            }
          }
          // fromSole recovers white leather next to dark soles — but must NOT
          // fire for flat studio AA that only touches a dark/chromatic hem.
          // Require clear lift above the card; modest JPEG lift (+2–5) next to
          // a blazer/jeans silhouette is studio, not leather.
          const fromSole =
            darkKeepNeighbor &&
            (nearWhiteLeather ||
              (luma >= studioLuma + 7 &&
                keepNeighbors >= 2 &&
                variance >= 6))
          if (brightKeepNeighbor || fromSole) {
            next[index] = 255
            gained += 1
          }
          continue
        }
        // Tight-neutral near-whites only reclaim via the bright path above —
        // otherwise slightly-off-card studio AA grows onto mauve hems. Beige /
        // warm fabric (higher chroma) still uses the paths below.
        if (isNearNeutral(rgb, 14) && luma >= 200) {
          continue
        }
        // Never reclaim pixels that still match the studio color — even when
        // adjacent to a high-contrast seam (variance spikes near logos/edges).
        if (colorDistance(rgb, corner) <= backdropTolerance) {
          continue
        }
        // Do not grow soft-shadow gray back onto the silhouette (puffer halo).
        if (
          isNearNeutral(rgb) &&
          luma >= 70 &&
          luma <= studioLuma - 28 &&
          rgb.r <= rgb.b + 10
        ) {
          continue
        }
        // Border bands: never reclaim mid-tone neutrals / foreign footers
        // (concrete under caps). Interior warm/beige fabric may still reclaim.
        const borderBand = Math.max(6, Math.floor(height * 0.05))
        if (y < borderBand || y >= height - borderBand) {
          const distCorner = colorDistance(rgb, corner)
          if (
            distCorner >= 26 &&
            isNearNeutralBright(rgb) &&
            luma >= 55 &&
            luma <= 210
          ) {
            continue
          }
          if (
            isNearNeutralBright(rgb) &&
            luma >= 60 &&
            luma <= 210 &&
            !isWarmGarmentFabric(rgb, luma)
          ) {
            continue
          }
        }
        // Flat near-card neutrals are studio — never grow false FG around dark
        // silhouettes (blazer / jeans angular card slabs). White leather uses
        // the brighter-than-studio path above instead.
        if (
          isNearNeutralBright(rgb) &&
          luma >= studioLuma - 10 &&
          luma <= studioLuma + 8 &&
          variance <= 22 &&
          !isWarmGarmentFabric(rgb, luma)
        ) {
          continue
        }
        next[index] = 255
        gained += 1
      }
    }
    mask.data.set(next)
    restored += gained
    if (gained === 0) {
      break
    }
  }

  return restored
}

/**
 * True when a KEEP pixel looks like leftover soft shadow / white AA.
 * Studio-matching pixels are handled by a shallow edge pass — including them
 * in the deep BFS would eat white garments that sit near the card color.
 */
function isBackdropFringePixel(
  imageData: ImageData,
  x: number,
  y: number,
  studioLuma: number,
  depth: number,
): boolean {
  const rgb = readRgb(imageData, x, y)
  const luma = luminanceAt(imageData, x, y)
  // Never peel protected bright garment (sneaker leather / white tee weave).
  if (isBrightGarmentAt(imageData, x, y, studioLuma)) {
    return false
  }
  // Near-studio bright AA / card blowout only. White garments often sit only
  // +2–6 above a near-white card — never peel any clear lift (sneakers/tees).
  // Flat card AA at ≈ studio luma remains peelable for dark-bag silhouettes.
  if (luma >= 220 && isNearNeutralBright(rgb)) {
    if (luma > studioLuma + 1) {
      return false
    }
    // Specular leather / textured white panels must not become a BFS tunnel.
    if (localLumaVariance(imageData, x, y) > 16) {
      return false
    }
    return depth <= 2
  }
  // Soft shadow / floor contact clearly darker than the studio card.
  // Skip warm fabric folds (beige hoodie hems) — true soft shadows are neutral.
  // Floor at 55 peels cap/sneaker contact shadows without eating black fabric (~40).
  if (isNearNeutral(rgb) && luma >= 55 && luma <= studioLuma - 28) {
    if (rgb.r > rgb.b + 10) {
      return false
    }
    return true
  }
  return false
}

/**
 * True when the pixel itself is dark fabric inside a dark KEEP body.
 * Soft-shadow gray next to a hem must NOT match — those still need peeling.
 */
function isInteriorDarkGarment(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  x: number,
  y: number,
): boolean {
  const selfLuma = luminanceAt(imageData, x, y)
  if (selfLuma >= 50) {
    return false
  }
  const width = mask.width
  const height = mask.height
  let darkKeep = 0
  let keep = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue
      }
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue
      }
      const index = ny * width + nx
      if (mask.data[index] !== 255) {
        continue
      }
      keep += 1
      if (luminanceAt(imageData, nx, ny) < 50) {
        darkKeep += 1
      }
    }
  }
  return keep >= 4 && darkKeep >= 3
}

/**
 * Drop KEEP fringe pixels that are studio AA / soft shadow, not garment.
 * Outside-in BFS peels thick gray/white rings that 4-connected "dark neighbor"
 * tests miss (similar mid-gray bands around puffers; white AA on gray rings).
 */
function chokeBackdropFringe(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  corner: Rgb,
  fringeTolerance: number,
): number {
  const width = mask.width
  const height = mask.height
  const cornerLuma =
    0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  // Fill-frame crops often have no light studio on the border (corner lands on
  // dark fabric). Still peel mid-gray soft shadows as if a light card exists.
  const border = collectBorderFlatSamples(imageData)
  const hasLightStudio = border.some((sample) => sample.luma >= 160)
  const studioLuma = hasLightStudio ? cornerLuma : Math.max(cornerLuma, 210)
  const maxDepth = 8
  const depth = new Int16Array(width * height)
  depth.fill(-1)
  const queue: number[] = []

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (mask.data[index] !== 0) {
        continue
      }
      depth[index] = 0
      queue.push(index)
    }
  }

  // Fill-frame crops: soft-shadow gray often sits on the image border with no
  // REMOVE neighbor. Seed those border fringe pixels so BFS can walk inward.
  let choked = 0
  const seedBorder = (x: number, y: number) => {
    const index = y * width + x
    if (mask.data[index] !== 255 || depth[index]! >= 0) {
      return
    }
    if (!isBackdropFringePixel(imageData, x, y, studioLuma, 1)) {
      return
    }
    mask.data[index] = 0
    depth[index] = 0
    queue.push(index)
    choked += 1
  }
  for (let x = 0; x < width; x += 1) {
    seedBorder(x, 0)
    seedBorder(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    seedBorder(0, y)
    seedBorder(width - 1, y)
  }

  let head = 0
  while (head < queue.length) {
    const index = queue[head++]!
    const d = depth[index]!
    if (d >= maxDepth) {
      continue
    }
    const x = index % width
    const y = (index / width) | 0
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y + 1 < height ? index + width : -1,
    ]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || mask.data[neighbor] !== 255 || depth[neighbor]! >= 0) {
        continue
      }
      const nx = neighbor % width
      const ny = (neighbor / width) | 0
      // Never tunnel into black garment interiors (JPEG mid-gray noise).
      if (isInteriorDarkGarment(mask, imageData, nx, ny)) {
        continue
      }
      // Bright neutrals above the card are usually garment — but flat AA that
      // hugs a dark hem must still peel (sweater/cap/handbag halos). Require
      // a dark KEEP neighbor + low variance so sneaker leather is not tunneled.
      if (isBrightGarmentAt(imageData, nx, ny, studioLuma)) {
        const rgbBright = readRgb(imageData, nx, ny)
        const lumaBright = luminanceAt(imageData, nx, ny)
        const varBright = localLumaVariance(imageData, nx, ny)
        let darkKeep = 0
        for (const n2 of [neighbor - 1, neighbor + 1, neighbor - width, neighbor + width]) {
          if (n2 < 0 || n2 >= mask.data.length || mask.data[n2] !== 255) {
            continue
          }
          if (luminanceAt(imageData, n2 % width, (n2 / width) | 0) < 100) {
            darkKeep += 1
          }
        }
        if (
          darkKeep < 1 ||
          varBright > 6 ||
          !isNearNeutralBright(rgbBright) ||
          lumaBright > studioLuma + 6 ||
          d >= 5
        ) {
          continue
        }
      } else if (!isBackdropFringePixel(imageData, nx, ny, studioLuma, d + 1)) {
        continue
      }
      mask.data[neighbor] = 0
      depth[neighbor] = d + 1
      queue.push(neighbor)
      choked += 1
    }
  }

  // Shallow peel of studio-matching AA left by variance-gated flat remove,
  // plus soft mid-gray still hugging a darker garment hem (puffer bottom).
  // Extra passes: peel bright AA first (touches REMOVE), then soft-shadow gray
  // that was trapped behind the AA ring, then any leftover halo.
  for (let pass = 0; pass < 10; pass += 1) {
    const next = new Uint8Array(mask.data)
    let gained = 0
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x
        if (mask.data[index] !== 255) {
          continue
        }
        const touchesRemove =
          mask.data[index - 1] === 0 ||
          mask.data[index + 1] === 0 ||
          mask.data[index - width] === 0 ||
          mask.data[index + width] === 0
        if (!touchesRemove) {
          continue
        }
        if (isInteriorDarkGarment(mask, imageData, x, y)) {
          continue
        }
        const rgb = readRgb(imageData, x, y)
        const matchesStudio = colorDistance(rgb, corner) <= fringeTolerance
        const lumaPeek = luminanceAt(imageData, x, y)
        // Never peel warm garment fabric as "studio match" fringe.
        if (isWarmGarmentFabric(rgb, lumaPeek)) {
          continue
        }
        let softOnDark = false
        let brightHaloOnDark = false
        let isolatedBrightFringe = false
        // Fringe signals must run even when RGB is within studio tolerance —
        // near-white AA rings around dark bags often match the card closely,
        // and skipping them left KEEP halos (handbag / fringe tests).
        if (isNearNeutralBright(rgb)) {
          const luma = lumaPeek
          let minKeep = 255
          let darkKeep = 0
          let garmentKeep = 0
          let interiorBrightKeep = 0
          for (const neighbor of [
            index - 1,
            index + 1,
            index - width,
            index + width,
          ]) {
            if (mask.data[neighbor] !== 255) {
              continue
            }
            const nx = neighbor % width
            const ny = (neighbor / width) | 0
            const neighborRgb = readRgb(imageData, nx, ny)
            const neighborLuma = luminanceAt(imageData, nx, ny)
            minKeep = Math.min(minKeep, neighborLuma)
            if (neighborLuma < 100) {
              darkKeep += 1
              garmentKeep += 1
            } else if (isWarmGarmentFabric(neighborRgb, neighborLuma)) {
              // Camel coat / beige hem — treat as garment for AA peel.
              garmentKeep += 1
            } else {
              const nChroma =
                Math.max(neighborRgb.r, neighborRgb.g, neighborRgb.b) -
                Math.min(neighborRgb.r, neighborRgb.g, neighborRgb.b)
              // Mauve/satin dress and other chromatic mid-tones.
              if (nChroma >= 18 && neighborLuma <= studioLuma - 15) {
                garmentKeep += 1
              }
            }
            if (neighborLuma >= 200) {
              // Interior bright fabric does not itself touch REMOVE (white tee
              // body). Edge-only AA rings only neighbor other edge AA.
              const nTouchesRemove =
                (nx > 0 && mask.data[neighbor - 1] === 0) ||
                (nx + 1 < width && mask.data[neighbor + 1] === 0) ||
                (ny > 0 && mask.data[neighbor - width] === 0) ||
                (ny + 1 < height && mask.data[neighbor + width] === 0)
              if (!nTouchesRemove) {
                interiorBrightKeep += 1
              }
            }
          }
          if (luma >= 70 && luma <= 160) {
            softOnDark = garmentKeep >= 1 && luma >= minKeep + 12
          }
          // Mid-gray soft halo trapped behind a bright AA ring never 4-connects
          // to the dark body (corner geometry). Once AA is peeled it touches
          // REMOVE — peel only flat, tight-neutral dim pixels so beige hems /
          // sneaker suede are not eaten.
          if (
            !softOnDark &&
            isNearNeutral(rgb, 12) &&
            luma >= 70 &&
            luma <= 150 &&
            luma <= studioLuma - 28 &&
            localLumaVariance(imageData, x, y) <= 10
          ) {
            softOnDark = true
          }
          // White AA ring around dark OR chromatic garment (dress/coat/bag).
          // Flat 3×3 AA only — textured leather next to dark soles stays.
          brightHaloOnDark =
            luma >= 190 &&
            garmentKeep >= 1 &&
            luma >= minKeep + 30 &&
            localLumaVariance(imageData, x, y, 1) <= 8
          // Near-white edge AA with no interior bright body (bags / AA rings).
          // White tees / sneaker panels keep an interior bright neighbor that
          // does not touch REMOVE — that blocks this signal.
          isolatedBrightFringe = luma >= 220 && interiorBrightKeep === 0
        }
        if (
          !matchesStudio &&
          !softOnDark &&
          !brightHaloOnDark &&
          !isolatedBrightFringe
        ) {
          continue
        }
        // Studio-color match alone must not peel white leather/tees. Allow peel
        // only when an explicit fringe signal fires (AA ring / soft shadow), or
        // the pixel is not a protected bright garment.
        if (
          matchesStudio &&
          !softOnDark &&
          !brightHaloOnDark &&
          !isolatedBrightFringe &&
          isBrightGarmentAt(imageData, x, y, studioLuma)
        ) {
          continue
        }
        // Corner case: bright AA ring outside a mid-gray soft halo never sees a
        // dark KEEP neighbor (gray sits in between). Treat near-white pixels that
        // touch REMOVE and sit above the studio card as fringe when they lack a
        // bright garment body — already covered by isolatedBrightFringe.
        next[index] = 0
        gained += 1
      }
    }
    mask.data.set(next)
    choked += gained
    if (gained === 0) {
      break
    }
  }

  // Second fringe BFS: bright AA rings can block the first pass from reaching
  // mid-gray soft shadow. After shallow AA peel, walk inward again.
  depth.fill(-1)
  queue.length = 0
  head = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (mask.data[index] !== 0) {
        continue
      }
      depth[index] = 0
      queue.push(index)
    }
  }
  while (head < queue.length) {
    const index = queue[head++]!
    const d = depth[index]!
    if (d >= maxDepth) {
      continue
    }
    const x = index % width
    const y = (index / width) | 0
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y + 1 < height ? index + width : -1,
    ]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || mask.data[neighbor] !== 255 || depth[neighbor]! >= 0) {
        continue
      }
      const nx = neighbor % width
      const ny = (neighbor / width) | 0
      if (isInteriorDarkGarment(mask, imageData, nx, ny)) {
        continue
      }
      if (isBrightGarmentAt(imageData, nx, ny, studioLuma)) {
        const rgbBright = readRgb(imageData, nx, ny)
        const lumaBright = luminanceAt(imageData, nx, ny)
        const varBright = localLumaVariance(imageData, nx, ny)
        let darkKeep = 0
        for (const n2 of [neighbor - 1, neighbor + 1, neighbor - width, neighbor + width]) {
          if (n2 < 0 || n2 >= mask.data.length || mask.data[n2] !== 255) {
            continue
          }
          if (luminanceAt(imageData, n2 % width, (n2 / width) | 0) < 100) {
            darkKeep += 1
          }
        }
        if (
          darkKeep < 1 ||
          varBright > 6 ||
          !isNearNeutralBright(rgbBright) ||
          lumaBright > studioLuma + 6 ||
          d >= 5
        ) {
          continue
        }
      } else if (!isBackdropFringePixel(imageData, nx, ny, studioLuma, d + 1)) {
        continue
      }
      mask.data[neighbor] = 0
      depth[neighbor] = d + 1
      queue.push(neighbor)
      choked += 1
    }
  }

  return choked
}

/**
 * Public edge cleanup for use after morph close / hole fill (those ops can
 * reintroduce studio fringe that an earlier choke already removed).
 * Set restoreTexture false on the final pass so weave restore cannot put
 * studio AA back onto the silhouette before feather/export.
 */
export function chokeMaskEdgeFringe(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance = 40,
  options: { restoreTexture?: boolean } = {},
): number {
  const corner = averageCornerColor(imageData)
  const choked = chokeBackdropFringe(
    mask,
    imageData,
    corner,
    Math.max(28, Math.floor(tolerance * 0.85)),
  )
  // Morph-close + choke can nibble light textured garments — restore weave.
  if (options.restoreTexture !== false) {
    restoreTexturedKeeps(mask, imageData, 12)
  }
  return choked
}

/**
 * Catalog scrapes often bake a near-white UI chrome strip into the left/right
 * margin, or a solid colored footer bar (blue/black UI chrome). Clear those
 * full-height columns / full-width rows near the edges.
 */
export function removeBrightEdgeChrome(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  luminanceThreshold = CHROME_LUMA,
  // Catalog chrome is often ~78–100% of the column; keep this under 0.8.
  coverageRatio = 0.75,
): number {
  const width = mask.width
  const height = mask.height
  const maxInsetX = Math.max(8, Math.floor(width * 0.12))
  const maxInsetY = Math.max(10, Math.floor(height * 0.14))
  let painted = 0

  /** Only strip UI chrome pixels — never wipe garment fabric in the same row. */
  const looksLikeChromePixel = (x: number, y: number): boolean => {
    const rgb = readRgb(imageData, x, y)
    const luma = luminanceAt(imageData, x, y)
    const chroma =
      Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
    if (luma >= luminanceThreshold && isNearNeutralBright(rgb)) {
      return true
    }
    // Saturated UI bars (blue/teal footers). Warm beige/camel fabric also has
    // mid chroma — require cool or strongly saturated color to avoid hems.
    if (
      chroma >= 36 &&
      localLumaVariance(imageData, x, y) <= 50 &&
      (rgb.b >= rgb.r || chroma >= 48)
    ) {
      return true
    }
    if (luma < 40 && localLumaVariance(imageData, x, y) <= 50) {
      return true
    }
    return false
  }

  /** White soles / leather near the frame look like chrome — keep if dark-adjacent. */
  const touchesDarkKeep = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        if (mask.data[ny * width + nx]! < 128) continue
        if (luminanceAt(imageData, nx, ny) < 110) return true
      }
    }
    return false
  }

  const clearColumn = (x: number) => {
    for (let y = 0; y < height; y += 1) {
      const index = y * width + x
      if (mask.data[index] === 0) {
        continue
      }
      if (!looksLikeChromePixel(x, y)) {
        continue
      }
      if (touchesDarkKeep(x, y)) {
        continue
      }
      mask.data[index] = 0
      painted += 1
    }
  }

  const clearRow = (y: number) => {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (mask.data[index] === 0) {
        continue
      }
      if (!looksLikeChromePixel(x, y)) {
        continue
      }
      if (touchesDarkKeep(x, y)) {
        continue
      }
      mask.data[index] = 0
      painted += 1
    }
  }

  const columnBright = (x: number): boolean => {
    let bright = 0
    for (let y = 0; y < height; y += 1) {
      if (luminanceAt(imageData, x, y) >= luminanceThreshold) {
        bright += 1
      }
    }
    return bright / height >= coverageRatio
  }

  const rowBright = (y: number): boolean => {
    let bright = 0
    for (let x = 0; x < width; x += 1) {
      if (luminanceAt(imageData, x, y) >= luminanceThreshold) {
        bright += 1
      }
    }
    return bright / width >= coverageRatio
  }

  /** Solid saturated footer/header bar (e.g. blue UI strip under product shots). */
  const rowSolidChrome = (y: number): boolean => {
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let sumSq = 0
    let chromatic = 0
    for (let x = 0; x < width; x += 1) {
      const rgb = readRgb(imageData, x, y)
      sumR += rgb.r
      sumG += rgb.g
      sumB += rgb.b
      const luma = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
      sumSq += luma * luma
      const chroma =
        Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
      if (chroma >= 28) {
        chromatic += 1
      }
    }
    const n = width
    const meanR = sumR / n
    const meanG = sumG / n
    const meanB = sumB / n
    const meanLuma = 0.299 * meanR + 0.587 * meanG + 0.114 * meanB
    const variance = sumSq / n - meanLuma * meanLuma
    const chroma =
      Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB)
    // Flat saturated strip, or flat near-black UI bar.
    if (variance < 100 && (chroma >= 24 || meanLuma < 40)) {
      return true
    }
    // Gradient blue/teal footers: high per-pixel chroma even when row variance
    // is large (left→right ramps on scraped catalog chrome). Mean chroma can
    // stay modest on desaturated UI bars — coverage alone is enough.
    if (chromatic / n >= 0.55) {
      return true
    }
    return false
  }

  for (let x = 0; x < maxInsetX; x += 1) {
    if (columnBright(x)) {
      clearColumn(x)
    }
  }
  for (let x = width - maxInsetX; x < width; x += 1) {
    if (columnBright(x)) {
      clearColumn(x)
    }
  }
  /** Wipe an entire UI chrome bar (blue footer) — not just matching pixels. */
  const clearRowFully = (y: number) => {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (mask.data[index] === 0) {
        continue
      }
      mask.data[index] = 0
      painted += 1
    }
  }

  for (let y = 0; y < maxInsetY; y += 1) {
    if (rowSolidChrome(y)) {
      clearRowFully(y)
    } else if (rowBright(y)) {
      clearRow(y)
    }
  }
  for (let y = height - maxInsetY; y < height; y += 1) {
    if (rowSolidChrome(y)) {
      clearRowFully(y)
    } else if (rowBright(y)) {
      clearRow(y)
    }
  }

  return painted
}

/**
 * Clear foreign header/footer bands baked into scraped catalog photos
 * (blue UI bars, concrete strips, room-scene footers, multi-color scrapes).
 * Uses border connectivity + row/region evidence — not a fixed strip height.
 * Stops before dark garment hems/brims/soles. Mask only — never modifies RGB.
 */
export function stripForeignBorderBands(
  mask: MaskPixelBuffer,
  imageData: ImageData,
): number {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  // Search window only — clearing stops on garment evidence, not at this depth.
  const maxInset = Math.max(16, Math.floor(height * 0.28))
  let painted = 0

  const rowProfile = (y: number) => {
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let sumL = 0
    let sumSq = 0
    let dark = 0
    let chromatic = 0
    let foreignPx = 0
    let minL = 255
    let maxL = 0
    let leftR = 0
    let leftG = 0
    let leftB = 0
    let rightR = 0
    let rightG = 0
    let rightB = 0
    const mid = (width / 2) | 0
    for (let x = 0; x < width; x += 1) {
      const rgb = readRgb(imageData, x, y)
      const luma = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
      sumR += rgb.r
      sumG += rgb.g
      sumB += rgb.b
      sumL += luma
      sumSq += luma * luma
      if (luma < minL) minL = luma
      if (luma > maxL) maxL = luma
      if (luma < 55) {
        dark += 1
      }
      const chroma =
        Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
      if (chroma >= 28) {
        chromatic += 1
      }
      if (colorDistance(rgb, corner) >= 28) {
        foreignPx += 1
      }
      if (x < mid) {
        leftR += rgb.r
        leftG += rgb.g
        leftB += rgb.b
      } else {
        rightR += rgb.r
        rightG += rgb.g
        rightB += rgb.b
      }
    }
    const n = width
    const nLeft = Math.max(1, mid)
    const nRight = Math.max(1, width - mid)
    const mean = {
      r: sumR / n,
      g: sumG / n,
      b: sumB / n,
    }
    const meanLuma = sumL / n
    const left = {
      r: leftR / nLeft,
      g: leftG / nLeft,
      b: leftB / nLeft,
    }
    const right = {
      r: rightR / nRight,
      g: rightG / nRight,
      b: rightB / nRight,
    }
    return {
      mean,
      meanLuma,
      variance: sumSq / n - meanLuma * meanLuma,
      darkRatio: dark / n,
      chromaticRatio: chromatic / n,
      foreignRatio: foreignPx / n,
      lumaSpan: maxL - minL,
      halfDist: colorDistance(left, right),
      dist: colorDistance(mean, corner),
      chroma:
        Math.max(mean.r, mean.g, mean.b) - Math.min(mean.r, mean.g, mean.b),
    }
  }

  type RowProfile = ReturnType<typeof rowProfile>

  /** Real garment hem / sole / brim row — stop peeling here. */
  const isGarmentHemRow = (profile: RowProfile): boolean => {
    // Blue UI / scrape chrome is never a hem, even with dark speckles.
    if (profile.chromaticRatio >= 0.3) {
      return false
    }
    // Mostly-foreign mottled concrete without a solid dark garment mass.
    if (profile.foreignRatio >= 0.55 && profile.darkRatio < 0.2) {
      return false
    }
    if (profile.darkRatio >= 0.12 && profile.dist < 40) {
      return true
    }
    // Garment touching the border: row mean is mixed with studio so dist is
    // large — still stop when a solid dark mass dominates the row.
    if (
      profile.darkRatio >= 0.2 &&
      profile.meanLuma < 150 &&
      profile.chromaticRatio < 0.25
    ) {
      return true
    }
    return false
  }

  const isForeignRow = (profile: RowProfile): boolean => {
    if (isGarmentHemRow(profile)) {
      return false
    }
    // Blue/teal UI chrome footers (solid or gradient).
    if (profile.chromaticRatio >= 0.35 && profile.mean.b >= profile.mean.r + 8) {
      return true
    }
    // Abrupt left/right color break across a full-width scrape band.
    if (profile.halfDist >= 40 && profile.foreignRatio >= 0.35) {
      return true
    }
    // Multi-color / high-span rows still mostly off-card (room-scene footers).
    if (profile.lumaSpan >= 60 && profile.foreignRatio >= 0.4) {
      return true
    }
    // Concrete / room-scene / mismatched floor vs studio card.
    if (profile.dist >= 24) {
      return true
    }
    // Majority of pixels individually foreign even if mean is washed.
    if (profile.foreignRatio >= 0.55) {
      return true
    }
    // High-texture foreign strip still off the card.
    if (profile.variance >= 160 && profile.dist >= 14) {
      return true
    }
    return false
  }

  const isWhiteSeparator = (profile: RowProfile): boolean =>
    profile.meanLuma >= 225 &&
    isNearNeutral(profile.mean, 22) &&
    profile.variance < 100 &&
    profile.chromaticRatio < 0.15

  const clearRowFully = (y: number) => {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (mask.data[index] === 0) {
        continue
      }
      mask.data[index] = 0
      painted += 1
    }
  }

  const walkEdge = (fromBottom: boolean) => {
    let cleared = 0
    const start = fromBottom ? height - 1 : 0
    const end = fromBottom ? height - maxInset : maxInset
    const step = fromBottom ? -1 : 1
    for (
      let y = start;
      fromBottom ? y >= end : y < end;
      y += step
    ) {
      const profile = rowProfile(y)
      if (isGarmentHemRow(profile)) {
        break
      }
      if (isForeignRow(profile)) {
        clearRowFully(y)
        cleared += 1
        continue
      }
      // Thin white separator between studio and foreign footer/header.
      if (cleared > 0 && isWhiteSeparator(profile)) {
        clearRowFully(y)
        cleared += 1
        continue
      }
      // Peek ahead: white at the outer edge with foreign just inside — clear both.
      if (cleared === 0 && isWhiteSeparator(profile)) {
        const peekY = y + step
        const peekOk = fromBottom ? peekY >= end : peekY < end
        if (peekOk) {
          const peek = rowProfile(peekY)
          if (isForeignRow(peek)) {
            clearRowFully(y)
            cleared += 1
            continue
          }
        }
      }
      break
    }
  }

  walkEdge(true)
  walkEdge(false)

  // Connectivity: any remaining KEEP touching the bottom (or top) border that
  // looks foreign gets flooded off — catches speckled multi-color leftovers
  // that survive row-mean checks without eating interior garment islands.
  painted += stripBorderConnectedForeignPixels(mask, imageData, corner, true)
  painted += stripBorderConnectedForeignPixels(mask, imageData, corner, false)

  return painted
}

/**
 * Flood-clear KEEP pixels connected to the top or bottom image border when
 * they look like foreign scrape (not dark/chromatic/warm garment fabric).
 */
function stripBorderConnectedForeignPixels(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  corner: Rgb,
  fromBottom: boolean,
): number {
  const width = mask.width
  const height = mask.height
  const visited = new Uint8Array(width * height)
  const queue: number[] = []
  let painted = 0

  const seedY = fromBottom ? height - 1 : 0
  for (let x = 0; x < width; x += 1) {
    const index = seedY * width + x
    if (mask.data[index]! === 0) {
      continue
    }
    if (!isForeignBorderPixel(imageData, x, seedY, corner)) {
      continue
    }
    queue.push(index)
    visited[index] = 1
  }

  let head = 0
  const bandLimit = Math.max(16, Math.floor(height * 0.28))
  while (head < queue.length) {
    const index = queue[head++]!
    const x = index % width
    const y = (index / width) | 0
    mask.data[index] = 0
    painted += 1

    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y + 1 < height ? index + width : -1,
    ]
    for (const n of neighbors) {
      if (n < 0 || visited[n] || mask.data[n]! === 0) {
        continue
      }
      const nx = n % width
      const ny = (n / width) | 0
      const inset = fromBottom ? height - 1 - ny : ny
      if (inset > bandLimit) {
        continue
      }
      if (!isForeignBorderPixel(imageData, nx, ny, corner)) {
        continue
      }
      visited[n] = 1
      queue.push(n)
    }
  }
  return painted
}

function isForeignBorderPixel(
  imageData: ImageData,
  x: number,
  y: number,
  corner: Rgb,
): boolean {
  const rgb = readRgb(imageData, x, y)
  const luma = luminanceAt(imageData, x, y)
  const chroma =
    Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
  const dist = colorDistance(rgb, corner)
  // Preserve dark garment / soft contact shadow (dist to a bright card is large).
  if (luma < 75 && chroma < 30) {
    return false
  }
  // Preserve warm / chromatic garment fabric.
  if (isWarmGarmentFabric(rgb, luma)) {
    return false
  }
  if (chroma >= 36 && luma < 200) {
    // Saturated garment (not blue UI alone — blue UI is foreign)
    if (rgb.b >= rgb.r + 25 && rgb.b >= 140) {
      return true
    }
    if (chroma >= 40 && dist < 30) {
      return false
    }
  }
  // White leather / bright neutrals near card — not foreign footer.
  if (isNearNeutralBright(rgb) && luma >= cornerLuma(corner) - 4 && dist < 36) {
    const variance = localLumaVariance(imageData, x, y, 1)
    if (variance > 8 || luma > cornerLuma(corner) + 2) {
      return false
    }
  }
  return dist >= 26 || (chroma >= 40 && rgb.b > rgb.r + 15)
}

function cornerLuma(corner: Rgb): number {
  return 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
}

/**
 * True when a KEEP pixel is leftover studio card (flat gray/white), not garment.
 * Textured bright neutrals (white tee weave) are protected; flat card blowout
 * that still matches the corner color can be peeled.
 */
function isRemovableStudioPixel(
  imageData: ImageData,
  x: number,
  y: number,
  corner: Rgb,
  studioLuma: number,
  tolerance: number,
  maxVariance = 36,
): boolean {
  const rgb = readRgb(imageData, x, y)
  const luma = luminanceAt(imageData, x, y)
  const variance = localLumaVariance(imageData, x, y)
  const height = imageData.height
  const borderBand = Math.max(10, Math.floor(height * 0.08))
  const nearVerticalBorder = y < borderBand || y >= height - borderBand

  // Scraped catalog footers often look warm-beige; allow peeling flat bands
  // on the top/bottom edge only — never interior camel/beige garment. Require
  // clear distance from the studio card so near-card warm fabric (caps) stays.
  if (isWarmGarmentFabric(rgb, luma)) {
    if (
      nearVerticalBorder &&
      variance <= 8 &&
      luma >= 140 &&
      luma <= 200 &&
      colorDistance(rgb, corner) >= 30
    ) {
      return true
    }
    return false
  }
  const dist = colorDistance(rgb, corner)
  // Near-card neutrals are studio even when 3×3 variance is inflated by an
  // adjacent dark hem (blazer/jeans angular slabs). Keep this band modest so
  // interior white leather at card+4–5 can still be protected by dark-connected
  // pale marks; peelExteriorStudioKeep widens the band for exterior slabs.
  if (
    isNearNeutralBright(rgb) &&
    dist <= Math.min(tolerance, 36) &&
    luma >= 170 &&
    luma <= studioLuma + 6
  ) {
    return true
  }
  // Flat JPEG card often sits 1–3 L above the corner estimate. Treat that as
  // removable studio; only protect clearly lifted / textured pale (leather).
  const flatCardLift =
    isNearNeutralBright(rgb) &&
    variance <= 12 &&
    dist <= Math.min(tolerance, 28) &&
    luma >= 170 &&
    luma <= studioLuma + 3.5
  if (flatCardLift) {
    return true
  }
  // Lifted white leather / blowout above the card — never removable here.
  // Edge AA on dark garments is handled by silhouette refine / choke instead.
  if (isNearNeutralBright(rgb) && luma > studioLuma + 0.5) {
    return false
  }
  if (isBrighterThanStudio(rgb, luma, studioLuma, 12, variance)) {
    return false
  }
  // Near-card flat studio (at or slightly below card). Do not include the
  // studioLuma+14 band — that erased sneaker panels at card+2–10.
  if (
    dist <= Math.min(tolerance, 28) &&
    isNearNeutralBright(rgb) &&
    luma >= 170 &&
    luma <= studioLuma + 0.5
  ) {
    return true
  }
  if (variance > maxVariance) {
    return false
  }
  if (dist <= Math.max(tolerance, 36) && luma <= studioLuma + 0.5) {
    return true
  }
  // Flat mid/light gray card even when slightly off the estimated corner.
  return (
    isNearNeutral(rgb, 24) &&
    luma >= 170 &&
    luma <= studioLuma + 0.5
  )
}

/**
 * Mark pale KEEP within a limited geodesic distance of dark KEEP.
 * Protects white leather / light fabric attached to soles without shielding
 * the entire border-connected studio card (which also looks pale).
 *
 * @param minLiftAboveStudio - optional floor on luma vs studio (enclosed-strip
 *   uses a higher lift so flat handle-hole card can still clear).
 */
function markDarkConnectedPale(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  studioLuma: number,
  minLiftAboveStudio = -4,
  maxDistOverride?: number,
): Uint8Array {
  const width = mask.width
  const height = mask.height
  const protectedPale = new Uint8Array(width * height)
  const distFromDark = new Int16Array(width * height)
  distFromDark.fill(-1)
  const queue: number[] = []
  // Keep pale reclaim local to soles/panels — long geodesics shield brim/card.
  const maxDist =
    maxDistOverride ??
    Math.max(14, Math.min(28, Math.floor(Math.min(width, height) * 0.1)))
  const borderBand = Math.max(2, Math.floor(Math.min(width, height) * 0.02))

  const isPaleKeep = (x: number, y: number): boolean => {
    if (mask.data[y * width + x]! < 128) return false
    const rgb = readRgb(imageData, x, y)
    const L = luminanceAt(imageData, x, y)
    if (isWarmGarmentFabric(rgb, L)) return false
    if (!isNearNeutral(rgb, 28)) return false
    if (L < 175) return false
    if (L < studioLuma + minLiftAboveStudio) return false
    // Prefer lifted leather. Near-card must NOT be shielded: dark-hem
    // adjacency inflates 3×3 variance and previously protected angular
    // studio slabs on blazer/jeans as if they were white leather.
    const variance = localLumaVariance(imageData, x, y, 1)
    const lift = L - studioLuma
    // Near-zero lift is flat card (even with edge-inflated variance).
    if (lift < 2.5) return false
    // Flat white leather at card+3–6 attached to dark soles must stay.
    if (lift < 3.5 && variance < 2) return false
    return true
  }

  const nearOuterBorder = (x: number, y: number): boolean =>
    x < borderBand ||
    y < borderBand ||
    x >= width - borderBand ||
    y >= height - borderBand

  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! < 128) continue
    const x = i % width
    const y = (i / width) | 0
    if (luminanceAt(imageData, x, y) >= 100) continue
    for (const n of [
      x > 0 ? i - 1 : -1,
      x + 1 < width ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y + 1 < height ? i + width : -1,
    ]) {
      if (n < 0 || distFromDark[n]! >= 0) continue
      const nx = n % width
      const ny = (n / width) | 0
      if (nearOuterBorder(nx, ny)) continue
      if (!isPaleKeep(nx, ny)) continue
      distFromDark[n] = 1
      protectedPale[n] = 1
      queue.push(n)
    }
  }

  let head = 0
  while (head < queue.length) {
    const i = queue[head++]!
    const d0 = distFromDark[i]!
    if (d0 < 0 || d0 >= maxDist) continue
    const x = i % width
    const y = (i / width) | 0
    for (const n of [
      x > 0 ? i - 1 : -1,
      x + 1 < width ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y + 1 < height ? i + width : -1,
    ]) {
      if (n < 0 || distFromDark[n]! >= 0) continue
      const nx = n % width
      const ny = (n / width) | 0
      if (nearOuterBorder(nx, ny)) continue
      if (!isPaleKeep(nx, ny)) continue
      distFromDark[n] = d0 + 1
      protectedPale[n] = 1
      queue.push(n)
    }
  }
  return protectedPale
}

/**
 * Peel flat studio KEEP that still touches the image border (or is reachable
 * from it through other flat studio). Fixes leftover gray card slabs around
 * white tees after reclaim/morph. Never enters white garment or warm fabric.
 * Also never enters pale leather/fabric that is connected to dark KEEP structure.
 */
export function stripBorderConnectedStudio(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance = 40,
): number {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  // Lifted / textured pale attached to dark soles must survive border flood.
  // Short radius — longer walks re-shield cap/card after flat JPEG lift.
  const protectedPale = markDarkConnectedPale(mask, imageData, studioLuma, 0.5, 18)
  const competitionProtect = markCompetitionProtectedPale(mask, imageData)
  for (let i = 0; i < protectedPale.length; i += 1) {
    if (competitionProtect[i]) protectedPale[i] = 1
  }
  const visited = new Uint8Array(width * height)
  const queue: number[] = []
  let painted = 0

  const isStudioKeep = (x: number, y: number): boolean => {
    const index = y * width + x
    if (protectedPale[index]) return false
    return isRemovableStudioPixel(imageData, x, y, corner, studioLuma, tolerance)
  }

  /**
   * Soft alpha (1–254) used to act as a hard wall: flood only walked through
   * exact 0 / exact 255, so JPEG-softened studio slabs around dark garments
   * (blazer / jeans / hoodie) never peeled. Traverse REMOVE + soft/solid
   * studio; stop on protected / garment KEEP.
   */
  const seed = (x: number, y: number) => {
    const index = y * width + x
    if (visited[index]) {
      return
    }
    visited[index] = 1
    const alpha = mask.data[index]!
    if (alpha > 0 && isStudioKeep(x, y)) {
      mask.data[index] = 0
      painted += 1
      queue.push(index)
      return
    }
    if (alpha === 0 || alpha < 96) {
      // Empty or weak uncertain fringe — traversable background channel.
      if (alpha > 0 && alpha < 96) {
        mask.data[index] = 0
        painted += 1
      }
      queue.push(index)
    }
  }

  for (let x = 0; x < width; x += 1) {
    seed(x, 0)
    seed(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    seed(0, y)
    seed(width - 1, y)
  }

  let head = 0
  while (head < queue.length) {
    const index = queue[head++]!
    const x = index % width
    const y = (index / width) | 0
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y + 1 < height ? index + width : -1,
    ]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || visited[neighbor]) {
        continue
      }
      visited[neighbor] = 1
      const nx = neighbor % width
      const ny = (neighbor / width) | 0
      const alpha = mask.data[neighbor]!
      if (alpha === 0) {
        queue.push(neighbor)
        continue
      }
      if (isStudioKeep(nx, ny)) {
        mask.data[neighbor] = 0
        painted += 1
        queue.push(neighbor)
        continue
      }
      // Weak soft fringe that is not protected garment — still traversable so
      // softened AA rings cannot shield interior studio KEEP blobs.
      if (alpha < 96) {
        mask.data[neighbor] = 0
        painted += 1
        queue.push(neighbor)
      }
    }
  }

  return painted
}

/**
 * Peel studio-like KEEP from the exterior inward. Removes angular card
 * protrusions that stay attached to a dark garment through soft AA bridges
 * (blazer / jeans / hoodie) without wiping white-tee bodies: each pass only
 * clears removable studio that already touches REMOVE or the image border.
 */
export function peelExteriorStudioKeep(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance = 40,
  maxPasses = 28,
): number {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const protectedPale = markDarkConnectedPale(mask, imageData, studioLuma, 1.5, 16)
  const competitionProtect = markCompetitionProtectedPale(mask, imageData)
  for (let i = 0; i < protectedPale.length; i += 1) {
    if (competitionProtect[i]) protectedPale[i] = 1
  }

  let painted = 0
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const kill: number[] = []
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        if (mask.data[index]! < 128) continue
        const rgb = readRgb(imageData, x, y)
        const luma = luminanceAt(imageData, x, y)
        const dist = colorDistance(rgb, corner)
        // Wider near-card band than isRemovableStudioPixel — catalog cards
        // often sit +6–10 L above the corner sample (blazer JPEG vignette).
        const nearCardStudio =
          isNearNeutralBright(rgb) &&
          dist <= Math.min(tolerance, 36) &&
          luma >= 170 &&
          luma <= studioLuma + 10
        if (
          !nearCardStudio &&
          !isRemovableStudioPixel(imageData, x, y, corner, studioLuma, tolerance)
        ) {
          continue
        }
        // Near-card studio stays peelable even if pale-protect marked it
        // (edge variance false positive). Clearly lifted leather stays.
        if (protectedPale[index]) {
          const lift = luma - studioLuma
          // Catalog card vignette often lands at card+6–9; only keep protect
          // for clearly lifted leather panels.
          if (lift >= 9) continue
          if (!nearCardStudio) continue
        }
        const onBorder =
          x === 0 || y === 0 || x === width - 1 || y === height - 1
        let touchesRemove = onBorder
        if (!touchesRemove) {
          for (const n of [
            index - 1,
            index + 1,
            index - width,
            index + width,
          ]) {
            if (n < 0 || n >= mask.data.length) continue
            if (mask.data[n]! < 96) {
              touchesRemove = true
              break
            }
          }
        }
        if (!touchesRemove) continue
        kill.push(index)
      }
    }
    if (kill.length === 0) break
    for (const index of kill) {
      mask.data[index] = 0
      painted += 1
    }
  }
  return painted
}

/**
 * Remove KEEP components that touch the image border and look like studio card
 * (not garment). Complements stripBorderConnectedStudio when soft AA bridges
 * previously isolated large angular card slabs (blazer / jeans / hoodie).
 * Never clears components with meaningful dark / chromatic / warm garment mass.
 */
export function stripBorderTouchingStudioComponents(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance = 40,
): number {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const visited = new Uint8Array(width * height)
  let painted = 0

  for (let start = 0; start < mask.data.length; start += 1) {
    if (visited[start] || mask.data[start]! < 128) {
      continue
    }
    const component: number[] = []
    const queue: number[] = [start]
    visited[start] = 1
    let studioLike = 0
    let garmentLike = 0
    let touchesBorder = false

    let head = 0
    while (head < queue.length) {
      const index = queue[head++]!
      component.push(index)
      const x = index % width
      const y = (index / width) | 0
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true
      }
      const rgb = readRgb(imageData, x, y)
      const luma = luminanceAt(imageData, x, y)
      const chroma =
        Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
      if (
        isWarmGarmentFabric(rgb, luma) ||
        luma < 90 ||
        (chroma >= 16 && luma <= studioLuma - 15)
      ) {
        garmentLike += 1
      } else if (
        isNearNeutralBright(rgb) &&
        luma >= 165 &&
        colorDistance(rgb, corner) <= Math.max(tolerance, 44)
      ) {
        studioLike += 1
      }
      for (const neighbor of [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]) {
        if (neighbor < 0 || visited[neighbor] || mask.data[neighbor]! < 128) {
          continue
        }
        visited[neighbor] = 1
        queue.push(neighbor)
      }
    }

    if (!touchesBorder) {
      continue
    }
    const total = component.length
    if (total < 24) {
      continue
    }
    // Require dominant studio evidence and almost no garment evidence.
    if (garmentLike > total * 0.04 || studioLike < total * 0.7) {
      continue
    }
    for (const index of component) {
      mask.data[index] = 0
      painted += 1
    }
  }

  return painted
}

/**
 * Clear enclosed KEEP pockets that are flat studio (collar openings, between
 * handbag handles, limb gaps). Walks ONLY through removable studio KEEP so a
 * dark bag body does not merge handle-hole card into one mixed component.
 */
export function stripEnclosedFlatStudio(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance = 40,
): number {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  // Lifted pale near dark structure (sneakers). Flat handle-hole card clears.
  // Longer radius than border strip — enclosed holes sit inside the shoe.
  const enclosedDist = Math.max(22, Math.min(40, Math.floor(Math.min(width, height) * 0.14)))
  const protectedPale = markDarkConnectedPale(
    mask,
    imageData,
    studioLuma,
    0.75,
    enclosedDist,
  )
  const competitionProtect = markCompetitionProtectedPale(mask, imageData)
  for (let i = 0; i < protectedPale.length; i += 1) {
    if (competitionProtect[i]) protectedPale[i] = 1
  }
  const visited = new Uint8Array(width * height)
  let painted = 0

  const isStudioKeep = (x: number, y: number): boolean => {
    if (mask.data[y * width + x] !== 255) {
      return false
    }
    if (protectedPale[y * width + x]) {
      return false
    }
    const rgb = readRgb(imageData, x, y)
    const luma = luminanceAt(imageData, x, y)
    // Dark / mid garment walls are never "enclosed studio".
    if (luma < 170 || !isNearNeutralBright(rgb)) {
      return false
    }
    // White leather / tee panels sit clearly above the card — never enclosed
    // studio. Flat handle-hole card may sit at studio+0–4 from JPEG lift.
    const variance1 = localLumaVariance(imageData, x, y, 1)
    if (isBrighterThanStudio(rgb, luma, studioLuma, 12, variance1)) {
      return false
    }
    if (luma > studioLuma + 4) {
      return false
    }
    // Use a tight 3×3 variance so dark straps beside a handle hole do not
    // inflate 5×5 variance and hide flat card pockets.
    if (variance1 > 12) {
      return false
    }
    const dist = colorDistance(rgb, corner)
    return dist <= Math.max(tolerance, 36)
  }

  for (let start = 0; start < mask.data.length; start += 1) {
    if (visited[start] || mask.data[start] !== 255) {
      continue
    }
    const sx = start % width
    const sy = (start / width) | 0
    if (!isStudioKeep(sx, sy)) {
      visited[start] = 1
      continue
    }

    const component: number[] = []
    const queue: number[] = [start]
    visited[start] = 1
    let touchesBorder = false

    let head = 0
    while (head < queue.length) {
      const index = queue[head++]!
      component.push(index)
      const x = index % width
      const y = (index / width) | 0
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true
      }
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor]) {
          continue
        }
        const nx = neighbor % width
        const ny = (neighbor / width) | 0
        if (!isStudioKeep(nx, ny)) {
          // Mark non-studio KEEP visited so we don't restart from AA bridges.
          if (mask.data[neighbor] === 255) {
            visited[neighbor] = 1
          }
          continue
        }
        visited[neighbor] = 1
        queue.push(neighbor)
      }
    }

    // Border-connected studio is handled by stripBorderConnectedStudio.
    if (touchesBorder) {
      continue
    }
    // Tiny AA speckles stay; clear real enclosed card pockets (handle holes).
    if (component.length < 4) {
      continue
    }
    for (const index of component) {
      mask.data[index] = 0
      painted += 1
    }
  }

  return painted
}

/**
 * Clear bright near-studio KEEP that sits in a gap between dark KEEP walls on
 * the same row or column (handbag handle arches, strap gaps). Open tops mean
 * these regions are often border-connected, so enclosed-component strip misses
 * them. Does not clear white leather panels (only one dark contact side).
 */
export function stripOpenArchStudio(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance = 40,
): number {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const maxGap = Math.max(24, Math.floor(Math.min(width, height) * 0.35))
  let painted = 0

  const isStudioGapPixel = (x: number, y: number): boolean => {
    // Include soft KEEP — AA bridges often sit at 80–180 and block hole clear.
    if (mask.data[y * width + x]! < 60) return false
    const rgb = readRgb(imageData, x, y)
    const L = luminanceAt(imageData, x, y)
    if (isWarmGarmentFabric(rgb, L)) return false
    if (L < 130) return false
    if (!isNearNeutral(rgb, 32)) return false
    const d = colorDistance(rgb, corner)
    // Allow JPEG lift above the card; reject far-off fabric.
    if (d > Math.max(tolerance + 14, 56) && L > studioLuma + 30) return false
    if (d > Math.max(tolerance + 24, 64)) return false
    return true
  }

  const isDarkKeep = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    if (mask.data[y * width + x]! < 128) return false
    return luminanceAt(imageData, x, y) < 95
  }

  // Horizontal gaps between dark walls
  for (let y = 1; y < height - 1; y += 1) {
    let x = 0
    while (x < width) {
      while (x < width && !isDarkKeep(x, y)) x += 1
      if (x >= width) break
      const left = x
      while (x < width && isDarkKeep(x, y)) x += 1
      const gapStart = x
      while (x < width && !isDarkKeep(x, y)) x += 1
      const gapEnd = x
      if (x >= width || !isDarkKeep(x, y)) continue
      const gapLen = gapEnd - gapStart
      if (gapLen < 2 || gapLen > maxGap) continue
      let studioLike = 0
      for (let gx = gapStart; gx < gapEnd; gx += 1) {
        if (isStudioGapPixel(gx, y)) studioLike += 1
      }
      if (studioLike < gapLen * 0.55) continue
      // Two dark walls on this row = handle/strap arch. White leather panels
      // only contact dark on one side, so they never form this gap pattern.
      for (let gx = gapStart; gx < gapEnd; gx += 1) {
        if (!isStudioGapPixel(gx, y)) continue
        mask.data[y * width + gx] = 0
        painted += 1
      }
      void left
    }
  }

  // Vertical gaps between dark walls (side strap openings)
  for (let x = 1; x < width - 1; x += 1) {
    let y = 0
    while (y < height) {
      while (y < height && !isDarkKeep(x, y)) y += 1
      if (y >= height) break
      while (y < height && isDarkKeep(x, y)) y += 1
      const gapStart = y
      while (y < height && !isDarkKeep(x, y)) y += 1
      const gapEnd = y
      if (y >= height || !isDarkKeep(x, y)) continue
      const gapLen = gapEnd - gapStart
      if (gapLen < 2 || gapLen > maxGap) continue
      let studioLike = 0
      for (let gy = gapStart; gy < gapEnd; gy += 1) {
        if (isStudioGapPixel(x, gy)) studioLike += 1
      }
      if (studioLike < gapLen * 0.55) continue
      for (let gy = gapStart; gy < gapEnd; gy += 1) {
        if (!isStudioGapPixel(x, gy)) continue
        mask.data[gy * width + x] = 0
        painted += 1
      }
    }
  }

  return painted
}

/**
 * Peel bright near-studio KEEP that sits against dark KEEP walls, walking
 * inward pass-by-pass. Breaks AA bridges that connect handle openings to the
 * outer border so topology pocket strip can finish the job. Protects bright
 * interiors that have flat bright neighbors away from dark walls (white leather).
 */
export function chokeBrightStudioBesideDark(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance = 40,
  passes = 8,
): number {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const fringeTol = Math.max(28, Math.floor(tolerance * 0.85))
  let painted = 0

  for (let pass = 0; pass < passes; pass += 1) {
    const clear: number[] = []
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x
        if (mask.data[i]! < 200) continue
        const rgb = readRgb(imageData, x, y)
        const L = luminanceAt(imageData, x, y)
        if (isWarmGarmentFabric(rgb, L)) continue
        if (L < 160) continue
        if (!isNearNeutral(rgb, 26)) continue
        const d = colorDistance(rgb, corner)
        // Allow JPEG lift; reject far-from-card fabric.
        if (d > fringeTol + 24 && L > studioLuma + 30) continue
        if (d > fringeTol + 36) continue

        let darkKeep = 0
        let brightFlatAway = 0
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const nx = x + dx
          const ny = y + dy
          const ni = ny * width + nx
          if (mask.data[ni]! < 128) continue
          const nL = luminanceAt(imageData, nx, ny)
          const nr = readRgb(imageData, nx, ny)
          if (nL < 95) {
            darkKeep += 1
            continue
          }
          if (
            nL >= 200 &&
            isNearNeutral(nr, 24) &&
            localLumaVariance(imageData, nx, ny, 1) <= 14
          ) {
            // Neighbor is deeper bright body if it does not itself touch dark.
            let nTouchesDark = false
            for (const [ex, ey] of [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
            ] as const) {
              const exx = nx + ex
              const eyy = ny + ey
              if (exx < 0 || eyy < 0 || exx >= width || eyy >= height) continue
              const ei = eyy * width + exx
              if (mask.data[ei]! >= 128 && luminanceAt(imageData, exx, eyy) < 95) {
                nTouchesDark = true
                break
              }
            }
            if (!nTouchesDark) brightFlatAway += 1
          }
        }
        if (darkKeep === 0) continue
        // Only peel the AA / bridge ring directly against dark walls. Pixels
        // with a bright flat interior neighbor are white leather / tee / deep
        // pocket body — pocket body is finished by stripDarkWalledStudioPockets
        // once AA bridges to the border are broken.
        if (brightFlatAway >= 1) continue
        // Lifted white leather (sneaker panels) — never choke, even when the
        // outer studio was cleared and the panel now touches REMOVE.
        if (L > studioLuma + 1) continue
        // Interior pale leather next to a dark sole (no REMOVE neighbor) must
        // not be choked — that was erasing sneaker panels from the sole up.
        const touchesRemove =
          mask.data[i - 1]! < 128 ||
          mask.data[i + 1]! < 128 ||
          mask.data[i - width]! < 128 ||
          mask.data[i + width]! < 128
        if (!touchesRemove && L >= studioLuma - 2) continue
        clear.push(i)
      }
    }
    if (clear.length === 0) break
    for (const i of clear) {
      mask.data[i] = 0
      painted += 1
    }
  }
  return painted
}

/**
 * Clear studio pockets enclosed by dark / chromatic KEEP walls (handbag
 * handle openings). Unlike stripEnclosedFlatStudio, this uses component
 * topology + mean appearance so wall-adjacent JPEG variance / card lift does
 * not hide the pocket. Does NOT clear:
 *  - border-connected studio
 *  - bright panels whose perimeter is mostly other bright KEEP (white leather)
 *  - chromatic / warm enclosed details (hardware gaps with metal tint)
 */
export function stripDarkWalledStudioPockets(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance = 40,
): number {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  // Handle openings can be large relative to small fixtures; white leather
  // panels are protected by dark-wall ratio, not this size cap alone.
  const maxPocket = Math.max(400, Math.floor(width * height * 0.14))
  const visited = new Uint8Array(width * height)
  let painted = 0

  const isBrightNeutralKeep = (x: number, y: number): boolean => {
    if (mask.data[y * width + x]! < 200) return false
    const rgb = readRgb(imageData, x, y)
    const L = luminanceAt(imageData, x, y)
    if (isWarmGarmentFabric(rgb, L)) return false
    if (L < 155) return false
    if (!isNearNeutralBright(rgb) && !isNearNeutral(rgb, 28)) return false
    if (L < studioLuma - 45) return false
    return true
  }

  for (let start = 0; start < mask.data.length; start += 1) {
    if (visited[start]) continue
    const sx = start % width
    const sy = (start / width) | 0
    if (!isBrightNeutralKeep(sx, sy)) {
      visited[start] = 1
      continue
    }

    const component: number[] = []
    const inComponent = new Uint8Array(width * height)
    const queue: number[] = [start]
    visited[start] = 1
    inComponent[start] = 1
    let touchesBorder = false
    let sumL = 0
    let sumDist = 0
    let sumChroma = 0

    let head = 0
    while (head < queue.length) {
      const index = queue[head++]!
      component.push(index)
      const x = index % width
      const y = (index / width) | 0
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true
      }
      const rgb = readRgb(imageData, x, y)
      const L = luminanceAt(imageData, x, y)
      const c =
        Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
      sumL += L
      sumChroma += c
      sumDist += colorDistance(rgb, corner)
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor]) continue
        const nx = neighbor % width
        const ny = (neighbor / width) | 0
        if (!isBrightNeutralKeep(nx, ny)) continue
        visited[neighbor] = 1
        inComponent[neighbor] = 1
        queue.push(neighbor)
      }
    }

    if (touchesBorder) continue
    const n = component.length
    if (n < 4 || n > maxPocket) continue

    const meanL = sumL / n
    const meanDist = sumDist / n
    const meanChroma = sumChroma / n
    if (meanChroma >= 28) continue
    if (meanDist > Math.max(tolerance + 8, 48)) continue
    if (meanL < 160) continue

    let darkWall = 0
    let brightKeepWall = 0
    let removeWall = 0
    let warmOrChromaWall = 0
    const seenEdge = new Uint8Array(width * height)
    for (const index of component) {
      const x = index % width
      const y = (index / width) | 0
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor < 0 || inComponent[neighbor]) continue
        if (seenEdge[neighbor]) continue
        seenEdge[neighbor] = 1

        const nx = neighbor % width
        const ny = (neighbor / width) | 0
        const mv = mask.data[neighbor]!
        const rgb = readRgb(imageData, nx, ny)
        const L = luminanceAt(imageData, nx, ny)
        const c =
          Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
        if (mv < 128) {
          removeWall += 1
          continue
        }
        if (isWarmGarmentFabric(rgb, L) || (c >= 22 && L < 200)) {
          warmOrChromaWall += 1
          continue
        }
        if (L < 95) {
          darkWall += 1
          continue
        }
        if (L >= 155 && isNearNeutral(rgb, 28)) {
          brightKeepWall += 1
        }
      }
    }

    const edgeTotal = darkWall + brightKeepWall + removeWall + warmOrChromaWall
    if (edgeTotal < 4) continue
    const darkRatio = darkWall / edgeTotal
    // Handle openings: dark leather walls. White leather panels sit among
    // other bright KEEP (low darkRatio) and must stay.
    if (darkRatio < 0.42) continue
    if (removeWall > darkWall * 2 && darkRatio < 0.55) continue

    for (const index of component) {
      mask.data[index] = 0
      painted += 1
    }
  }

  return painted
}

/**
 * Clear small detached KEEP islands that look like leftover studio flecks
 * (cap crown floaters, dress edge crumbs) — not attached to a substantial
 * dark/chromatic/warm garment body. Conservative size cap protects thin straps.
 */
export function stripDetachedStudioIslands(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance = 40,
): number {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const maxIsland = Math.max(40, Math.floor(width * height * 0.004))
  const visited = new Uint8Array(width * height)
  let painted = 0

  for (let start = 0; start < mask.data.length; start += 1) {
    if (visited[start] || mask.data[start] !== 255) {
      continue
    }
    const component: number[] = []
    const queue: number[] = [start]
    visited[start] = 1
    let studioLike = 0
    let garmentLike = 0
    let touchesBorder = false

    let head = 0
    while (head < queue.length) {
      const index = queue[head++]!
      component.push(index)
      const x = index % width
      const y = (index / width) | 0
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true
      }
      const rgb = readRgb(imageData, x, y)
      const luma = luminanceAt(imageData, x, y)
      const chroma =
        Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
      if (
        isWarmGarmentFabric(rgb, luma) ||
        luma < 80 ||
        (chroma >= 18 && luma <= studioLuma - 20)
      ) {
        garmentLike += 1
      } else if (
        isNearNeutralBright(rgb) &&
        luma >= 170 &&
        colorDistance(rgb, corner) <= Math.max(tolerance, 40)
      ) {
        studioLike += 1
      }
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor] || mask.data[neighbor] !== 255) {
          continue
        }
        visited[neighbor] = 1
        queue.push(neighbor)
      }
    }

    if (touchesBorder) {
      continue
    }
    const total = component.length
    if (total < 3 || total > maxIsland) {
      continue
    }
    // Any garment evidence (dark sole, chromatic body, warm fabric) means this
    // is not a leftover fleck — white leather attached to a dark sole must stay.
    if (garmentLike > 0 || studioLike < total * 0.85) {
      continue
    }
    for (const index of component) {
      mask.data[index] = 0
      painted += 1
    }
  }

  return painted
}

/**
 * Remove studio backdrop via inset corner floods (seeds skip catalog chrome),
 * global flat-backdrop cleanup, chrome strip, textured restore, light-fabric
 * reclaim, and fringe choke. Mask only — original pixels unchanged.
 */
export function removeSimilarToCorners(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  tolerance: number,
): number {
  const corner = averageCornerColor(imageData)
  const seeds = backdropFloodSeeds(imageData, corner, tolerance)

  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  let painted = 0
  // Clear chrome on the mask first so composites don't show strips even if
  // flood seeds miss a column.
  painted += removeBrightEdgeChrome(mask, imageData)
  // Near-white studio cards: tight flood only — a wide tolerance tunnels into
  // white sneakers/tees (leather often sits within RGB≈10 of a ~226 card).
  // Gray cards keep the full user tolerance.
  // Tol 8: leather at studio+3 stays outside flood while the card still clears.
  const floodTolerance =
    studioLuma >= 218 ? Math.min(tolerance, 8) : tolerance
  for (const [x, y] of seeds) {
    painted += floodRemoveBackdrop(
      mask,
      imageData,
      x,
      y,
      floodTolerance,
      studioLuma,
    )
  }
  // Chrome often partitions the gray card so flood cannot reach; remove flat
  // studio color globally (textured garments survive for restore/reclaim).
  // Skip / tighten on near-white cards — handled by border strip instead.
  if (studioLuma < 218) {
    painted += removeFlatStudioBackdrop(mask, imageData, corner, tolerance)
  } else {
    painted += removeFlatStudioBackdrop(
      mask,
      imageData,
      corner,
      Math.min(tolerance, 18),
      6,
    )
  }

  // Lower threshold so sneaker suede / soft leather weave is restored.
  const restoredTexture = restoreTexturedKeeps(mask, imageData, 3)
  // Enough iterations to fill beige/white garment bodies around logos/seams.
  const iterations = Math.max(
    12,
    Math.floor(Math.min(mask.width, mask.height) / 10),
  )
  const restoredDilate = reclaimGarmentFromKeep(
    mask,
    imageData,
    corner,
    iterations,
    Math.max(14, Math.floor(tolerance * 0.45)),
  )
  chokeBackdropFringe(mask, imageData, corner, Math.max(24, Math.floor(tolerance * 0.7)))
  // Near-white BFS can nibble textured light garments — put weave back.
  const restoredAfterChoke = restoreTexturedKeeps(mask, imageData, 12)
  // Reclaim restores near-white edge chrome (dissimilar from gray studio), so
  // strip chrome again after fabric recovery.
  painted += removeBrightEdgeChrome(mask, imageData)
  painted += stripForeignBorderBands(mask, imageData)
  // Final pass: any flat studio still attached to the border (common on white
  // tees where reclaim/morph reopened card regions).
  painted += stripBorderConnectedStudio(mask, imageData, tolerance)
  painted += stripEnclosedFlatStudio(mask, imageData, tolerance)
  painted += stripDetachedStudioIslands(mask, imageData, tolerance)

  return Math.max(0, painted - restoredTexture - restoredDilate - restoredAfterChoke)
}
