import {
  BIREFNET_INPUT_SIZE,
  BIREFNET_MEAN,
  BIREFNET_STD,
} from './constants'

/**
 * Resize RGB(A) ImageData to square `size` with bilinear sampling and
 * ImageNet-normalize into float32 NCHW `[1,3,H,W]`.
 * Never mutates the source ImageData buffer.
 */
export function preprocessImageDataToBirefNetTensor(
  imageData: ImageData,
  size = BIREFNET_INPUT_SIZE,
): Float32Array {
  if (imageData.width < 1 || imageData.height < 1) {
    throw new Error('BiRefNet preprocess: invalid image dimensions.')
  }
  if (size < 1) {
    throw new Error('BiRefNet preprocess: size must be positive.')
  }

  const { width: srcW, height: srcH, data } = imageData
  const out = new Float32Array(1 * 3 * size * size)
  const scaleX = srcW / size
  const scaleY = srcH / size

  const sampleChannel = (x: number, y: number, c: number): number => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(srcW - 1, x0 + 1)
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fx = x - x0
    const fy = y - y0
    const i00 = (y0 * srcW + x0) * 4 + c
    const i10 = (y0 * srcW + x1) * 4 + c
    const i01 = (y1 * srcW + x0) * 4 + c
    const i11 = (y1 * srcW + x1) * 4 + c
    const v00 = data[i00]!
    const v10 = data[i10]!
    const v01 = data[i01]!
    const v11 = data[i11]!
    return (
      v00 * (1 - fx) * (1 - fy) +
      v10 * fx * (1 - fy) +
      v01 * (1 - fx) * fy +
      v11 * fx * fy
    )
  }

  for (let y = 0; y < size; y += 1) {
    const sy = (y + 0.5) * scaleY - 0.5
    const cy = Math.min(srcH - 1, Math.max(0, sy))
    for (let x = 0; x < size; x += 1) {
      const sx = (x + 0.5) * scaleX - 0.5
      const cx = Math.min(srcW - 1, Math.max(0, sx))
      for (let c = 0; c < 3; c += 1) {
        const raw = sampleChannel(cx, cy, c) / 255
        const norm = (raw - BIREFNET_MEAN[c]!) / BIREFNET_STD[c]!
        out[c * size * size + y * size + x] = norm
      }
    }
  }

  return out
}

/** Canvas helper when callers have HTMLImageElement / Blob already drawn. */
export function imageDataFromCanvasDraw(
  source: CanvasImageSource,
  width: number,
  height: number,
): ImageData {
  if (width < 1 || height < 1) {
    throw new Error('BiRefNet: invalid canvas draw dimensions.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('BiRefNet: could not create 2D canvas context.')
  }
  ctx.drawImage(source, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}
