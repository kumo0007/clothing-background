import type { BackgroundState } from '../../types/background'
import type { MaskPixelBuffer } from '../../types/mask'
import { maskToAlphaImageData, maskToImageData } from '../mask/createMask'
import { renderBackground } from './renderBackground'

/**
 * Composite: output = original × mask + background × (1 − mask)
 * Mask WHITE (255) keeps original garment pixels unchanged.
 * Mask BLACK (0) shows the replacement background.
 * No generative processing — only alpha compositing.
 */
export function renderComposite(
  target: HTMLCanvasElement,
  original: CanvasImageSource,
  mask: MaskPixelBuffer,
  background: BackgroundState,
  backgroundImage: HTMLImageElement | ImageBitmap | null,
): void {
  const width = mask.width
  const height = mask.height
  target.width = width
  target.height = height
  const ctx = target.getContext('2d')
  if (!ctx) {
    return
  }

  // Transparent: leave clear alpha (PNG export). Checkerboard is CSS/preview only —
  // never bake it into the canvas (would force opaque ZIP/PNG backgrounds).
  if (background.type === 'transparent') {
    ctx.clearRect(0, 0, width, height)
  } else {
    renderBackground(ctx, width, height, background, backgroundImage)
  }

  // Build a garment layer, then clip it with the mask via drawImage.
  // IMPORTANT: putImageData ignores globalCompositeOperation, so the mask
  // must be applied with drawImage(destination-in), not putImageData.
  const garment = document.createElement('canvas')
  garment.width = width
  garment.height = height
  const gctx = garment.getContext('2d')
  if (!gctx) {
    return
  }

  gctx.drawImage(original, 0, 0, width, height)

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = width
  maskCanvas.height = height
  const mctx = maskCanvas.getContext('2d')
  if (!mctx) {
    return
  }
  mctx.putImageData(maskToAlphaImageData(mask), 0, 0)

  gctx.globalCompositeOperation = 'destination-in'
  gctx.drawImage(maskCanvas, 0, 0)

  ctx.drawImage(garment, 0, 0)
}

export function renderMaskPreview(
  target: HTMLCanvasElement,
  mask: MaskPixelBuffer,
): void {
  target.width = mask.width
  target.height = mask.height
  const ctx = target.getContext('2d')
  if (!ctx) {
    return
  }
  ctx.putImageData(maskToImageData(mask), 0, 0)
}

/** Reused buffers so 1000×1200 paint frames do not allocate every RAF tick. */
let overlayRgbA: Uint8ClampedArray | null = null
let overlayWidth = 0
let overlayHeight = 0
let overlayTint: HTMLCanvasElement | null = null

function getOverlayResources(width: number, height: number): {
  rgba: Uint8ClampedArray
  tint: HTMLCanvasElement
} {
  if (
    !overlayRgbA ||
    !overlayTint ||
    overlayWidth !== width ||
    overlayHeight !== height
  ) {
    overlayWidth = width
    overlayHeight = height
    overlayRgbA = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i += 1) {
      const offset = i * 4
      overlayRgbA[offset] = 220
      overlayRgbA[offset + 1] = 40
      overlayRgbA[offset + 2] = 40
      overlayRgbA[offset + 3] = 255
    }
    overlayTint = document.createElement('canvas')
    overlayTint.width = width
    overlayTint.height = height
  }
  return { rgba: overlayRgbA, tint: overlayTint }
}

/**
 * Draw edit overlay: original image with a translucent tint where mask is black.
 * Overlay is visual only and never written into the mask or final export.
 */
export function renderEditOverlay(
  target: HTMLCanvasElement,
  original: CanvasImageSource,
  mask: MaskPixelBuffer,
  width: number,
  height: number,
): void {
  const ctx = target.getContext('2d')
  if (!ctx) {
    return
  }
  if (target.width !== width || target.height !== height) {
    target.width = width
    target.height = height
  } else {
    ctx.clearRect(0, 0, width, height)
  }

  ctx.drawImage(original, 0, 0, width, height)

  const { rgba, tint } = getOverlayResources(width, height)
  const tctx = tint.getContext('2d')
  if (!tctx) {
    return
  }

  // Only alpha changes per frame; RGB stays red in the reused buffer.
  for (let i = 0; i < mask.data.length; i += 1) {
    rgba[i * 4 + 3] = 255 - mask.data[i]
  }
  tctx.putImageData(
    new ImageData(rgba as unknown as ImageDataArray, width, height),
    0,
    0,
  )
  ctx.globalAlpha = 0.45
  ctx.drawImage(tint, 0, 0)
  ctx.globalAlpha = 1
}
