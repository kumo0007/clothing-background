import type { BrushMode, MaskPixelBuffer } from '../../types/mask'

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
function averageCornerColor(imageData: ImageData): Rgb {
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
    return luma >= Math.max(studioLuma + margin, 226)
  }
  // Near-white studio: even mild micro-texture marks leather/suede as garment;
  // truly flat card (var≈0–2) stays removable via border flood/strip.
  if (variance > 2.5 && luma >= 210) {
    return true
  }
  return luma >= studioLuma + 5 && luma >= 218
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
  return rgb.r > rgb.b + 10 && chroma >= 12 && luma >= 130 && luma <= 220
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

      // Never put bright edge blowout back on the silhouette.
      if (touchesRemove && luma >= 220 && isNearNeutralBright(rgb)) {
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
function reclaimGarmentFromKeep(
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
        if (isBrighterThanStudio(rgb, luma, studioLuma, 12, variance)) {
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
          const fromSole =
            darkKeepNeighbor &&
            (variance > 3 ||
              keepNeighbors >= 2 ||
              colorDistance(rgb, corner) > backdropTolerance * 0.4)
          if (brightKeepNeighbor || fromSole) {
            next[index] = 255
            gained += 1
          }
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
  // Near-studio bright AA / card blowout only. White garments sit well above a
  // gray studio card — never peel those (tshirt / sneaker leather). Shallow
  // studio-matching / brightHalo passes still clear bag AA above this margin.
  if (luma >= 220 && isNearNeutralBright(rgb)) {
    if (luma > studioLuma + 8) {
      return false
    }
    // Specular leather / textured white panels must not become a BFS tunnel.
    if (localLumaVariance(imageData, x, y) > 22) {
      return false
    }
    return depth <= 3
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
      if (!isBackdropFringePixel(imageData, nx, ny, studioLuma, d + 1)) {
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
  for (let pass = 0; pass < 6; pass += 1) {
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
        if (!matchesStudio && isNearNeutralBright(rgb)) {
          const luma = luminanceAt(imageData, x, y)
          let minKeep = 255
          let darkKeep = 0
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
            const neighborLuma = luminanceAt(imageData, nx, ny)
            minKeep = Math.min(minKeep, neighborLuma)
            if (neighborLuma < 100) {
              darkKeep += 1
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
            softOnDark = darkKeep >= 1 && luma >= minKeep + 12
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
          // White AA ring around dark bag/hoodie — safe because white tees
          // rarely sit next to a dark keep neighbor at the silhouette.
          brightHaloOnDark =
            luma >= 190 && darkKeep >= 1 && luma >= minKeep + 40
          // Near-white edge AA with no interior bright body (bags / AA rings).
          // White tees keep an interior bright neighbor that does not touch REMOVE.
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
      if (!isBackdropFringePixel(imageData, nx, ny, studioLuma, d + 1)) {
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

  const clearColumn = (x: number) => {
    for (let y = 0; y < height; y += 1) {
      const index = y * width + x
      if (mask.data[index] === 0) {
        continue
      }
      if (!looksLikeChromePixel(x, y)) {
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
  // on the top/bottom edge only — never interior camel/beige hems.
  if (isWarmGarmentFabric(rgb, luma)) {
    if (
      nearVerticalBorder &&
      variance <= 18 &&
      luma >= 140 &&
      luma <= 210
    ) {
      return true
    }
    return false
  }
  if (variance > maxVariance) {
    return false
  }
  const dist = colorDistance(rgb, corner)
  // Bright neutrals above the card: only peel flat blowout that still sits
  // near the corner color. Textured white leather/jersey is never removable.
  if (isBrighterThanStudio(rgb, luma, studioLuma, 12, variance)) {
    return variance <= 4 && dist <= Math.min(tolerance, 22)
  }
  if (dist <= Math.max(tolerance, 36)) {
    return true
  }
  // Flat mid/light gray card even when slightly off the estimated corner.
  return (
    isNearNeutral(rgb, 24) &&
    luma >= 170 &&
    luma <= Math.max(232, studioLuma + 14)
  )
}

/**
 * Peel flat studio KEEP that still touches the image border (or is reachable
 * from it through other flat studio). Fixes leftover gray card slabs around
 * white tees after reclaim/morph. Never enters white garment or warm fabric.
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
  const visited = new Uint8Array(width * height)
  const queue: number[] = []
  let painted = 0

  const isStudioKeep = (x: number, y: number): boolean =>
    isRemovableStudioPixel(imageData, x, y, corner, studioLuma, tolerance)

  const seed = (x: number, y: number) => {
    const index = y * width + x
    if (visited[index]) {
      return
    }
    visited[index] = 1
    if (mask.data[index] === 255 && isStudioKeep(x, y)) {
      mask.data[index] = 0
      painted += 1
      queue.push(index)
      return
    }
    if (mask.data[index] === 0) {
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
      if (mask.data[neighbor] !== 255) {
        if (mask.data[neighbor] === 0) {
          queue.push(neighbor)
        }
        continue
      }
      if (!isStudioKeep(nx, ny)) {
        continue
      }
      mask.data[neighbor] = 0
      painted += 1
      queue.push(neighbor)
    }
  }

  return painted
}

/**
 * Clear enclosed KEEP pockets that are mostly flat studio (collar openings,
 * between-limb card scraps). Leaves textured / warm / bright garment bodies.
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
  const visited = new Uint8Array(width * height)
  let painted = 0

  for (let start = 0; start < mask.data.length; start += 1) {
    if (visited[start] || mask.data[start] !== 255) {
      continue
    }
    const component: number[] = []
    const queue: number[] = [start]
    visited[start] = 1
    let studioCount = 0
    let garmentCount = 0
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
      if (isRemovableStudioPixel(imageData, x, y, corner, studioLuma, tolerance, 28)) {
        studioCount += 1
      } else {
        garmentCount += 1
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

    // Border-connected garment bodies are handled by stripBorderConnectedStudio.
    // Only clear enclosed pockets that are predominantly removable studio.
    if (touchesBorder) {
      continue
    }
    const total = component.length
    if (total < 8 || studioCount < total * 0.72 || garmentCount > total * 0.2) {
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
  // white sneakers/tees. Gray cards keep the full user tolerance.
  const floodTolerance =
    studioLuma >= 218 ? Math.min(tolerance, 16) : tolerance
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
  // Final pass: any flat studio still attached to the border (common on white
  // tees where reclaim/morph reopened card regions).
  painted += stripBorderConnectedStudio(mask, imageData, tolerance)
  painted += stripEnclosedFlatStudio(mask, imageData, tolerance)

  return Math.max(0, painted - restoredTexture - restoredDilate - restoredAfterChoke)
}
