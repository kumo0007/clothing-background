import type {
  CropRect,
  ImageAdjustments,
  OutputFitMode,
} from '../../types/adjustments'
import {
  clampOutputDimension,
  clampShadowBlur,
  clampShadowOffset,
  clampShadowOpacity,
  normalizeCrop,
} from '../../types/adjustments'
import type { BackgroundState } from '../../types/background'
import type { MaskPixelBuffer } from '../../types/mask'
import { renderComposite } from './renderComposite'

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function drawBase(
  width: number,
  height: number,
  original: CanvasImageSource,
  mask: MaskPixelBuffer | null,
  background: BackgroundState | null,
  backgroundImage: HTMLImageElement | ImageBitmap | null,
  useComposite: boolean,
): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  if (useComposite && mask && background) {
    renderComposite(canvas, original, mask, background, backgroundImage)
    return canvas
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Could not create a 2D canvas context for the preview base.')
  }
  ctx.drawImage(original, 0, 0, width, height)
  return canvas
}

function applyColorAdjustments(
  source: HTMLCanvasElement,
  adjustments: ImageAdjustments,
): HTMLCanvasElement {
  const { brightness, contrast, saturation } = adjustments
  if (brightness === 0 && contrast === 0 && saturation === 0) {
    return source
  }

  const canvas = createCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return source
  }

  const b = 1 + brightness / 100
  const c = 1 + contrast / 100
  const s = 1 + saturation / 100
  ctx.filter = `brightness(${b}) contrast(${c}) saturate(${s})`
  ctx.drawImage(source, 0, 0)
  ctx.filter = 'none'
  return canvas
}

function applyCrop(
  source: HTMLCanvasElement,
  crop: CropRect | null,
): HTMLCanvasElement {
  if (!crop) {
    return source
  }
  const normalized = normalizeCrop(crop)
  const sx = Math.round(normalized.x * source.width)
  const sy = Math.round(normalized.y * source.height)
  const sw = Math.max(1, Math.round(normalized.width * source.width))
  const sh = Math.max(1, Math.round(normalized.height * source.height))
  const canvas = createCanvas(sw, sh)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return source
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
  return canvas
}

/**
 * Axis-aligned bounds after rotating a width×height rectangle by `degrees`.
 * Supports cardinal snaps and subtle tilt (client slight-rotation request).
 */
export function rotatedSize(
  width: number,
  height: number,
  degrees: number,
): { width: number; height: number } {
  const normalized = ((degrees % 360) + 360) % 360
  // Exact cardinals — avoid cos/sin float drift (90° → width 51).
  if (normalized === 0 || normalized === 180) {
    return { width, height }
  }
  if (normalized === 90 || normalized === 270) {
    return { width: height, height: width }
  }
  const rad = (degrees * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return {
    width: Math.max(1, Math.ceil(width * cos + height * sin)),
    height: Math.max(1, Math.ceil(width * sin + height * cos)),
  }
}

/** Output size after skewX/skewY (degrees). Uses affine x'=x+y·tanθx, y'=y+x·tanθy. */
export function skewedSize(
  width: number,
  height: number,
  skewXDegrees: number,
  skewYDegrees: number,
): { width: number; height: number; offsetX: number; offsetY: number } {
  const ax = Math.tan((skewXDegrees * Math.PI) / 180)
  const ay = Math.tan((skewYDegrees * Math.PI) / 180)
  const corners: Array<[number, number]> = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of corners) {
    const nx = x + ax * y
    const ny = y + ay * x
    minX = Math.min(minX, nx)
    minY = Math.min(minY, ny)
    maxX = Math.max(maxX, nx)
    maxY = Math.max(maxY, ny)
  }
  const offsetX = Object.is(-minX, -0) ? 0 : -minX
  const offsetY = Object.is(-minY, -0) ? 0 : -minY
  return {
    width: Math.max(1, Math.ceil(maxX - minX)),
    height: Math.max(1, Math.ceil(maxY - minY)),
    offsetX: offsetX === 0 ? 0 : offsetX,
    offsetY: offsetY === 0 ? 0 : offsetY,
  }
}

/** Average opaque corner color of a canvas — used to fill transform padding. */
function sampleCornerFillStyle(source: HTMLCanvasElement): string {
  const ctx = source.getContext('2d')
  if (!ctx || source.width < 2 || source.height < 2) {
    return '#ffffff'
  }
  const points: Array<[number, number]> = [
    [1, 1],
    [source.width - 2, 1],
    [1, source.height - 2],
    [source.width - 2, source.height - 2],
  ]
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (const [x, y] of points) {
    const pixel = ctx.getImageData(x, y, 1, 1).data
    if (pixel[3] < 16) {
      continue
    }
    r += pixel[0]
    g += pixel[1]
    b += pixel[2]
    n += 1
  }
  if (n === 0) {
    return '#ffffff'
  }
  return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`
}

function applySkew(
  source: HTMLCanvasElement,
  skewXDegrees: number,
  skewYDegrees: number,
): HTMLCanvasElement {
  if (skewXDegrees === 0 && skewYDegrees === 0) {
    return source
  }

  const ax = Math.tan((skewXDegrees * Math.PI) / 180)
  const ay = Math.tan((skewYDegrees * Math.PI) / 180)
  const bounds = skewedSize(
    source.width,
    source.height,
    skewXDegrees,
    skewYDegrees,
  )
  const canvas = createCanvas(bounds.width, bounds.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return source
  }

  // Fill expanded padding with the composite edge color (avoids black JPEG corners).
  ctx.fillStyle = sampleCornerFillStyle(source)
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // x' = x + ax·y ; y' = ay·x + y
  ctx.setTransform(1, ay, ax, 1, bounds.offsetX, bounds.offsetY)
  ctx.drawImage(source, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return canvas
}

function applyOrientation(
  source: HTMLCanvasElement,
  adjustments: ImageAdjustments,
): HTMLCanvasElement {
  const { rotation, flipHorizontal, flipVertical } = adjustments
  const tilt = adjustments.tilt ?? 0
  const angle = rotation + tilt
  if (angle === 0 && !flipHorizontal && !flipVertical) {
    return source
  }

  const size = rotatedSize(source.width, source.height, angle)
  const canvas = createCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return source
  }

  ctx.fillStyle = sampleCornerFillStyle(source)
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.translate(size.width / 2, size.height / 2)
  ctx.rotate((angle * Math.PI) / 180)
  ctx.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1)
  ctx.drawImage(source, -source.width / 2, -source.height / 2)
  return canvas
}

function parseCssColor(color: string): { r: number; g: number; b: number } {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex) {
    const raw = hex[1]!
    if (raw.length === 3) {
      return {
        r: parseInt(raw[0]! + raw[0]!, 16),
        g: parseInt(raw[1]! + raw[1]!, 16),
        b: parseInt(raw[2]! + raw[2]!, 16),
      }
    }
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    }
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color)
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
    }
  }
  return { r: 0, g: 0, b: 0 }
}

/**
 * Build a blurred silhouette layer. Pads the canvas so blur does not clip into
 * a hard rectangle (the old hard "gray slab" look).
 */
function buildBlurredSilhouette(
  mask: MaskPixelBuffer,
  color: { r: number; g: number; b: number },
  alpha: number,
  blur: number,
  offsetX: number,
  offsetY: number,
): ImageData {
  const width = mask.width
  const height = mask.height
  const pad = Math.max(0, Math.ceil(blur * 2) + 2)
  const pw = width + pad * 2
  const ph = height + pad * 2

  const sil = createCanvas(pw, ph)
  const silCtx = sil.getContext('2d')
  if (!silCtx) {
    return new ImageData(width, height)
  }
  const silData = silCtx.createImageData(pw, ph)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Feathered masks use gray alpha — silhouette from solid KEEP core.
      if (mask.data[y * width + x]! < 128) {
        continue
      }
      const o = ((y + pad) * pw + (x + pad)) * 4
      silData.data[o] = color.r
      silData.data[o + 1] = color.g
      silData.data[o + 2] = color.b
      silData.data[o + 3] = alpha
    }
  }
  silCtx.putImageData(silData, 0, 0)

  const blurred = createCanvas(pw, ph)
  const blurredCtx = blurred.getContext('2d')
  if (!blurredCtx) {
    return new ImageData(width, height)
  }
  if (blur > 0) {
    blurredCtx.filter = `blur(${blur}px)`
  }
  blurredCtx.drawImage(sil, 0, 0)
  blurredCtx.filter = 'none'

  // Crop back to output size with the requested offset.
  const out = createCanvas(width, height)
  const outCtx = out.getContext('2d')
  if (!outCtx) {
    return new ImageData(width, height)
  }
  outCtx.drawImage(blurred, pad - offsetX, pad - offsetY)
  return outCtx.getImageData(0, 0, width, height)
}

/**
 * Soft product shadow from the KEEP mask silhouette.
 * Dual layer (tight contact + soft ambient) for a natural ground contact look.
 * Drawn under the garment on background pixels only — original garment RGB
 * unchanged. No-op without a mask or when opacity is 0.
 */
export function applyProductShadow(
  source: HTMLCanvasElement,
  mask: MaskPixelBuffer | null,
  adjustments: ImageAdjustments,
): HTMLCanvasElement {
  const opacity = clampShadowOpacity(adjustments.shadowOpacity)
  if (!mask || opacity <= 0) {
    return source
  }
  if (mask.width !== source.width || mask.height !== source.height) {
    return source
  }

  const blur = clampShadowBlur(adjustments.shadowBlur)
  const offsetX = clampShadowOffset(adjustments.shadowOffsetX)
  const offsetY = clampShadowOffset(adjustments.shadowOffsetY)
  const color = parseCssColor(adjustments.shadowColor)
  const width = source.width
  const height = source.height

  const sourceCtx = source.getContext('2d')
  const out = createCanvas(width, height)
  const outCtx = out.getContext('2d')
  if (!sourceCtx || !outCtx) {
    return source
  }

  outCtx.putImageData(sourceCtx.getImageData(0, 0, width, height), 0, 0)

  // Layer A — soft ambient (wide blur, lower strength).
  const ambientBlur = Math.max(blur, Math.round(blur * 1.35) || 12)
  const ambientAlpha = Math.round((opacity / 100) * 255 * 0.45)
  const ambient = buildBlurredSilhouette(
    mask,
    color,
    ambientAlpha,
    ambientBlur,
    offsetX,
    offsetY,
  )

  // Layer B — tighter contact (less blur, stronger, slightly more offset down).
  const contactBlur = Math.max(4, Math.round(blur * 0.55))
  const contactAlpha = Math.round((opacity / 100) * 255 * 0.75)
  const contact = buildBlurredSilhouette(
    mask,
    color,
    contactAlpha,
    contactBlur,
    offsetX,
    offsetY + Math.max(1, Math.round(Math.abs(offsetY) * 0.25) || 2),
  )

  const outPixels = outCtx.getImageData(0, 0, width, height)

  const blendShadow = (shadow: ImageData) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        // Never paint over garment KEEP (incl. feathered core) — shadow on backdrop.
        if (mask.data[index]! >= 128) {
          continue
        }
        const so = index * 4
        const sa = shadow.data[so + 3]! / 255
        if (sa <= 0.004) {
          continue
        }
        // Soft alpha-blend of shadow color (reads natural on marble/wood/PNG).
        const o = so
        const inv = 1 - sa
        outPixels.data[o] = Math.round(shadow.data[so]! * sa + outPixels.data[o]! * inv)
        outPixels.data[o + 1] = Math.round(
          shadow.data[so + 1]! * sa + outPixels.data[o + 1]! * inv,
        )
        outPixels.data[o + 2] = Math.round(
          shadow.data[so + 2]! * sa + outPixels.data[o + 2]! * inv,
        )
        outPixels.data[o + 3] = Math.max(
          outPixels.data[o + 3]!,
          shadow.data[so + 3]!,
        )
      }
    }
  }

  blendShadow(ambient)
  blendShadow(contact)
  outCtx.putImageData(outPixels, 0, 0)
  return out
}

function applyBorder(
  source: HTMLCanvasElement,
  borderWidth: number,
  borderColor: string,
): HTMLCanvasElement {
  if (borderWidth <= 0) {
    return source
  }
  const width = source.width + borderWidth * 2
  const height = source.height + borderWidth * 2
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return source
  }
  ctx.fillStyle = borderColor
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, borderWidth, borderWidth)
  return canvas
}

function fitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: OutputFitMode,
): { dx: number; dy: number; dw: number; dh: number } {
  if (fit === 'stretch') {
    return { dx: 0, dy: 0, dw: targetWidth, dh: targetHeight }
  }
  const scale =
    fit === 'cover'
      ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
      : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const dw = sourceWidth * scale
  const dh = sourceHeight * scale
  return {
    dx: (targetWidth - dw) / 2,
    dy: (targetHeight - dh) / 2,
    dw,
    dh,
  }
}

/**
 * Resize the final composite into a fixed catalog canvas.
 * null width/height keeps the native pipeline size.
 */
export function applyOutputSize(
  source: HTMLCanvasElement,
  outputWidth: number | null,
  outputHeight: number | null,
  fit: OutputFitMode,
  padColor: string,
): HTMLCanvasElement {
  if (outputWidth === null || outputHeight === null) {
    return source
  }
  const width = clampOutputDimension(outputWidth)
  const height = clampOutputDimension(outputHeight)
  if (width === source.width && height === source.height && fit === 'stretch') {
    return source
  }

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    // Still return the sized canvas (jsdom without node-canvas).
    return canvas
  }

  // Fill first so JPEG / contain letterbox never leave transparent corners.
  ctx.fillStyle = padColor
  ctx.fillRect(0, 0, width, height)

  const rect = fitRect(source.width, source.height, width, height, fit)
  ctx.drawImage(source, rect.dx, rect.dy, rect.dw, rect.dh)
  return canvas
}

export type RenderFinalOptions = {
  original: CanvasImageSource
  width: number
  height: number
  mask: MaskPixelBuffer | null
  background: BackgroundState | null
  backgroundImage: HTMLImageElement | ImageBitmap | null
  adjustments: ImageAdjustments
  /** When true, composite mask+background before adjustments. */
  useComposite: boolean
}

/**
 * Final presentation pipeline (Phases 3–8):
 * base → color → shadow → crop → skew → rotate/flip → border → output size
 */
export function renderFinal(options: RenderFinalOptions): HTMLCanvasElement {
  const base = drawBase(
    options.width,
    options.height,
    options.original,
    options.mask,
    options.background,
    options.backgroundImage,
    options.useComposite,
  )
  const adjusted = applyColorAdjustments(base, options.adjustments)
  // Shadow needs the original-space mask, so it runs before crop/skew/rotate.
  const shadowed = applyProductShadow(
    adjusted,
    options.useComposite ? options.mask : null,
    options.adjustments,
  )
  const cropped = applyCrop(shadowed, options.adjustments.crop)
  const skewed = applySkew(
    cropped,
    options.adjustments.skewX,
    options.adjustments.skewY,
  )
  const oriented = applyOrientation(skewed, options.adjustments)
  const bordered = applyBorder(
    oriented,
    options.adjustments.borderWidth,
    options.adjustments.borderColor,
  )
  return applyOutputSize(
    bordered,
    options.adjustments.outputWidth,
    options.adjustments.outputHeight,
    options.adjustments.outputFit,
    options.adjustments.outputPadColor,
  )
}

export function renderFinalInto(
  target: HTMLCanvasElement,
  options: RenderFinalOptions,
): void {
  const result = renderFinal(options)
  target.width = result.width
  target.height = result.height
  const ctx = target.getContext('2d')
  if (!ctx) {
    throw new Error('Could not create a 2D canvas context for the preview target.')
  }
  ctx.clearRect(0, 0, target.width, target.height)
  ctx.drawImage(result, 0, 0)
}
