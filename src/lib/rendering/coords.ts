export type ViewTransform = {
  /** Uniform scale applied to the image. */
  scale: number
  /** Pan offset in screen/CSS pixels. */
  offsetX: number
  offsetY: number
}

export type Point = { x: number; y: number }

/**
 * Convert a pointer position (relative to the viewport element) into
 * original-image pixel coordinates.
 */
export function screenToImage(
  screenX: number,
  screenY: number,
  transform: ViewTransform,
): Point {
  return {
    x: (screenX - transform.offsetX) / transform.scale,
    y: (screenY - transform.offsetY) / transform.scale,
  }
}

export function imageToScreen(
  imageX: number,
  imageY: number,
  transform: ViewTransform,
): Point {
  return {
    x: imageX * transform.scale + transform.offsetX,
    y: imageY * transform.scale + transform.offsetY,
  }
}

export function clampScale(scale: number, min = 0.25, max = 4): number {
  return Math.min(max, Math.max(min, scale))
}

/** Fit the image inside a viewport while preserving aspect ratio. */
export function fitTransform(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 16,
): ViewTransform {
  const availableW = Math.max(1, viewportWidth - padding * 2)
  const availableH = Math.max(1, viewportHeight - padding * 2)
  const scale = Math.min(availableW / imageWidth, availableH / imageHeight, 1)
  const drawW = imageWidth * scale
  const drawH = imageHeight * scale
  return {
    scale,
    offsetX: (viewportWidth - drawW) / 2,
    offsetY: (viewportHeight - drawH) / 2,
  }
}

/**
 * Zoom around a screen-space focal point so the image point under the cursor
 * stays stable.
 */
export function zoomAtPoint(
  transform: ViewTransform,
  focalScreenX: number,
  focalScreenY: number,
  nextScale: number,
): ViewTransform {
  const imagePoint = screenToImage(focalScreenX, focalScreenY, transform)
  const scale = clampScale(nextScale)
  return {
    scale,
    offsetX: focalScreenX - imagePoint.x * scale,
    offsetY: focalScreenY - imagePoint.y * scale,
  }
}
