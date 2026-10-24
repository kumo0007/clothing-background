import type { BackgroundFitMode, BackgroundState } from '../../types/background'

export type BackgroundContentInset = {
  top: number
  right: number
  bottom: number
  left: number
}

export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cell = 12,
): void {
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const odd = ((x / cell) | 0) % 2 !== ((y / cell) | 0) % 2
      ctx.fillStyle = odd ? '#c8c8c8' : '#efefef'
      ctx.fillRect(x, y, cell, cell)
    }
  }
}

/**
 * Detect uniform near-white letterbox bars on environment images (e.g. beach
 * JPEG footers). Used so cover/contain sample the photographic content only —
 * otherwise the white bar becomes a rectangular remnant in the composite.
 */
export function measureUniformBorderInset(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: {
    lumaMin?: number
    chromaMax?: number
    coverage?: number
    maxFrac?: number
  } = {},
): BackgroundContentInset {
  const lumaMin = options.lumaMin ?? 248
  const chromaMax = options.chromaMax ?? 14
  const coverage = options.coverage ?? 0.9
  const maxFrac = options.maxFrac ?? 0.18

  const nearWhite = (o: number) => {
    const r = data[o]!
    const g = data[o + 1]!
    const b = data[o + 2]!
    const L = 0.299 * r + 0.587 * g + 0.114 * b
    const c = Math.max(r, g, b) - Math.min(r, g, b)
    return L >= lumaMin && c <= chromaMax
  }

  const rowIsBorder = (y: number) => {
    let hit = 0
    for (let x = 0; x < width; x += 1) {
      if (nearWhite((y * width + x) * 4)) hit += 1
    }
    return hit / width >= coverage
  }
  const colIsBorder = (x: number) => {
    let hit = 0
    for (let y = 0; y < height; y += 1) {
      if (nearWhite((y * width + x) * 4)) hit += 1
    }
    return hit / height >= coverage
  }

  const maxTop = Math.floor(height * maxFrac)
  const maxBottom = Math.floor(height * maxFrac)
  const maxLeft = Math.floor(width * maxFrac)
  const maxRight = Math.floor(width * maxFrac)

  let top = 0
  while (top < maxTop && rowIsBorder(top)) top += 1
  let bottom = 0
  while (bottom < maxBottom && rowIsBorder(height - 1 - bottom)) bottom += 1
  let left = 0
  while (left < maxLeft && colIsBorder(left)) left += 1
  let right = 0
  while (right < maxRight && colIsBorder(width - 1 - right)) right += 1

  // Keep at least a 4×4 content window.
  if (width - left - right < 4) {
    left = 0
    right = 0
  }
  if (height - top - bottom < 4) {
    top = 0
    bottom = 0
  }
  return { top, right, bottom, left }
}

function tryMeasureInsetFromSource(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
): BackgroundContentInset | null {
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = imageWidth
    canvas.height = imageHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(image, 0, 0, imageWidth, imageHeight)
    const { data } = ctx.getImageData(0, 0, imageWidth, imageHeight)
    return measureUniformBorderInset(data, imageWidth, imageHeight)
  } catch {
    return null
  }
}

function containRect(
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.min(targetWidth / imageWidth, targetHeight / imageHeight)
  const dw = imageWidth * scale
  const dh = imageHeight * scale
  return {
    dx: (targetWidth - dw) / 2,
    dy: (targetHeight - dh) / 2,
    dw,
    dh,
  }
}

function coverDestRect(
  contentWidth: number,
  contentHeight: number,
  targetWidth: number,
  targetHeight: number,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.max(
    targetWidth / contentWidth,
    targetHeight / contentHeight,
  )
  const dw = contentWidth * scale
  const dh = contentHeight * scale
  return {
    dx: (targetWidth - dw) / 2,
    dy: (targetHeight - dh) / 2,
    dw,
    dh,
  }
}

export function drawBackgroundImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number,
  fitMode: BackgroundFitMode,
  /** Solid fill for letterbox/pillarbox gaps when fit is "contain". */
  letterboxColor = '#F5F5F5',
  /** Optional precomputed inset; when omitted, near-white bars are auto-detected. */
  contentInset?: BackgroundContentInset | null,
): void {
  const inset =
    contentInset === undefined
      ? tryMeasureInsetFromSource(image, imageWidth, imageHeight)
      : contentInset
  const left = inset?.left ?? 0
  const top = inset?.top ?? 0
  const right = inset?.right ?? 0
  const bottom = inset?.bottom ?? 0
  const cw = Math.max(1, imageWidth - left - right)
  const ch = Math.max(1, imageHeight - top - bottom)

  if (fitMode === 'stretch') {
    ctx.drawImage(
      image,
      left,
      top,
      cw,
      ch,
      0,
      0,
      targetWidth,
      targetHeight,
    )
    return
  }

  if (fitMode === 'contain') {
    // Without a fill, letterbox bands stay transparent and show as
    // checkerboard holes in the composite / PNG export.
    ctx.fillStyle = letterboxColor
    ctx.fillRect(0, 0, targetWidth, targetHeight)
    const rect = containRect(cw, ch, targetWidth, targetHeight)
    ctx.drawImage(
      image,
      left,
      top,
      cw,
      ch,
      rect.dx,
      rect.dy,
      rect.dw,
      rect.dh,
    )
    return
  }

  const rect = coverDestRect(cw, ch, targetWidth, targetHeight)
  ctx.drawImage(
    image,
    left,
    top,
    cw,
    ch,
    rect.dx,
    rect.dy,
    rect.dw,
    rect.dh,
  )
}

/**
 * Paint the replacement background into a context sized to the garment image.
 * Transparent backgrounds use a checkerboard preview (not exported as content).
 */
export function renderBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: BackgroundState,
  backgroundImage: HTMLImageElement | ImageBitmap | null,
): void {
  ctx.clearRect(0, 0, width, height)

  if (background.type === 'transparent') {
    drawCheckerboard(ctx, width, height)
    return
  }

  if (background.type === 'color') {
    ctx.fillStyle = background.color
    ctx.fillRect(0, 0, width, height)
    return
  }

  if (background.type === 'image' && backgroundImage) {
    const iw =
      'naturalWidth' in backgroundImage
        ? backgroundImage.naturalWidth || width
        : backgroundImage.width
    const ih =
      'naturalHeight' in backgroundImage
        ? backgroundImage.naturalHeight || height
        : backgroundImage.height
    drawBackgroundImage(
      ctx,
      backgroundImage,
      iw,
      ih,
      width,
      height,
      background.fitMode,
      background.color,
    )
    return
  }

  drawCheckerboard(ctx, width, height)
}
