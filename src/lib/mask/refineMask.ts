import type { MaskPixelBuffer } from '../../types/mask'

/** Binary KEEP threshold for morphological ops (grays count as keep when ≥ 128). */
export const KEEP_THRESHOLD = 128

function isKeep(value: number): boolean {
  return value >= KEEP_THRESHOLD
}

function cloneData(mask: MaskPixelBuffer): Uint8ClampedArray {
  return new Uint8ClampedArray(mask.data)
}

/**
 * Morphological erode: a pixel stays KEEP only if every neighbor within
 * `radius` is KEEP. Removes thin protrusions / speckles from the garment.
 * Operates on the mask only — original image pixels are untouched.
 */
export function erodeMask(mask: MaskPixelBuffer, radius = 1): void {
  const r = Math.max(1, Math.floor(radius))
  const { width, height, data } = mask
  const source = cloneData(mask)
  const r2 = r * r

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (!isKeep(source[index])) {
        data[index] = 0
        continue
      }
      let keep = true
      for (let dy = -r; dy <= r && keep; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (dx * dx + dy * dy > r2) {
            continue
          }
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            keep = false
            break
          }
          if (!isKeep(source[ny * width + nx])) {
            keep = false
            break
          }
        }
      }
      data[index] = keep ? 255 : 0
    }
  }
}

/**
 * Morphological dilate: a pixel becomes KEEP if any neighbor within `radius`
 * is KEEP. Expands the garment mask and closes small gaps.
 */
export function dilateMask(mask: MaskPixelBuffer, radius = 1): void {
  const r = Math.max(1, Math.floor(radius))
  const { width, height, data } = mask
  const source = cloneData(mask)
  const r2 = r * r

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      let keep = false
      for (let dy = -r; dy <= r && !keep; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (dx * dx + dy * dy > r2) {
            continue
          }
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue
          }
          if (isKeep(source[ny * width + nx])) {
            keep = true
            break
          }
        }
      }
      data[index] = keep ? 255 : 0
    }
  }
}

/** Opening = erode then dilate — strips small KEEP speckles / thin spikes. */
export function morphOpenMask(mask: MaskPixelBuffer, radius = 1): void {
  erodeMask(mask, radius)
  dilateMask(mask, radius)
}

/** Closing = dilate then erode — fills small REMOVE holes / cracks in KEEP. */
export function morphCloseMask(mask: MaskPixelBuffer, radius = 1): void {
  dilateMask(mask, radius)
  erodeMask(mask, radius)
}

/**
 * Fill enclosed REMOVE regions that do not touch the image border.
 * Only fills components with area <= maxHoleArea so large gaps (e.g. between
 * jean legs) are not treated as garment holes. Returns pixels filled.
 */
export function fillMaskHoles(
  mask: MaskPixelBuffer,
  maxHoleArea?: number,
): number {
  const { width, height, data } = mask
  // Allow larger enclosed garment interiors (e.g. bag body hollowed by flood)
  // while still skipping huge between-leg gaps on full-bleed jeans.
  const limit =
    maxHoleArea ??
    Math.max(300, Math.floor(width * height * 0.16))
  const outside = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0

  const enqueue = (index: number) => {
    if (outside[index] !== 0) {
      return
    }
    if (isKeep(data[index])) {
      return
    }
    outside[index] = 1
    queue[tail] = index
    tail += 1
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width)
    enqueue(y * width + (width - 1))
  }

  while (head < tail) {
    const index = queue[head]
    head += 1
    const x = index % width
    const y = (index / width) | 0
    if (x > 0) {
      enqueue(index - 1)
    }
    if (x + 1 < width) {
      enqueue(index + 1)
    }
    if (y > 0) {
      enqueue(index - width)
    }
    if (y + 1 < height) {
      enqueue(index + width)
    }
  }

  const seen = new Uint8Array(width * height)
  let filled = 0
  for (let start = 0; start < data.length; start += 1) {
    if (isKeep(data[start]) || outside[start] !== 0 || seen[start] !== 0) {
      continue
    }
    head = 0
    tail = 0
    queue[tail] = start
    tail += 1
    seen[start] = 1
    const component: number[] = []
    while (head < tail) {
      const index = queue[head]
      head += 1
      component.push(index)
      const x = index % width
      const y = (index / width) | 0
      const tryNeighbor = (next: number) => {
        if (
          next < 0 ||
          next >= data.length ||
          seen[next] !== 0 ||
          isKeep(data[next]) ||
          outside[next] !== 0
        ) {
          return
        }
        seen[next] = 1
        queue[tail] = next
        tail += 1
      }
      if (x > 0) {
        tryNeighbor(index - 1)
      }
      if (x + 1 < width) {
        tryNeighbor(index + 1)
      }
      if (y > 0) {
        tryNeighbor(index - width)
      }
      if (y + 1 < height) {
        tryNeighbor(index + width)
      }
    }
    if (component.length > limit) {
      continue
    }
    for (const index of component) {
      data[index] = 255
      filled += 1
    }
  }
  return filled
}

/**
 * Soften the KEEP/REMOVE boundary by averaging binary coverage in a disk of
 * `radius`. Inward-only: REMOVE pixels stay 0 so soft alpha never samples
 * leftover studio RGB (avoids gray/white halos). Edge KEEP becomes gray.
 * Does not invent garment pixels — only changes mask opacity.
 */
export function featherMaskEdges(mask: MaskPixelBuffer, radius: number): void {
  const r = Math.max(1, Math.floor(radius))
  const { width, height, data } = mask
  const source = cloneData(mask)
  const r2 = r * r
  const binary = new Uint8Array(source.length)
  for (let i = 0; i < source.length; i += 1) {
    binary[i] = isKeep(source[i]) ? 1 : 0
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      // Never raise a REMOVE pixel — that would composite original studio RGB.
      if (!isKeep(source[index])) {
        data[index] = 0
        continue
      }
      let sum = 0
      let count = 0
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (dx * dx + dy * dy > r2) {
            continue
          }
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue
          }
          sum += binary[ny * width + nx]
          count += 1
        }
      }
      data[index] = count === 0 ? 0 : Math.round((255 * sum) / count)
    }
  }
}
