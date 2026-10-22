import type { BackgroundFitMode, BackgroundState } from '../../types/background'

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

function coverRect(
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number,
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.max(targetWidth / imageWidth, targetHeight / imageHeight)
  const dw = imageWidth * scale
  const dh = imageHeight * scale
  return {
    sx: 0,
    sy: 0,
    sw: imageWidth,
    sh: imageHeight,
    dx: (targetWidth - dw) / 2,
    dy: (targetHeight - dh) / 2,
    dw,
    dh,
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
): void {
  if (fitMode === 'stretch') {
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight)
    return
  }

  if (fitMode === 'contain') {
    // Without a fill, letterbox bands stay transparent and show as
    // checkerboard holes in the composite / PNG export.
    ctx.fillStyle = letterboxColor
    ctx.fillRect(0, 0, targetWidth, targetHeight)
    const rect = containRect(imageWidth, imageHeight, targetWidth, targetHeight)
    ctx.drawImage(image, rect.dx, rect.dy, rect.dw, rect.dh)
    return
  }

  const rect = coverRect(imageWidth, imageHeight, targetWidth, targetHeight)
  ctx.drawImage(
    image,
    rect.sx,
    rect.sy,
    rect.sw,
    rect.sh,
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
