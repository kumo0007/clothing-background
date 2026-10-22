import type { MaskPixelBuffer } from '../../types/mask'

/** Create a new mask buffer. Default: all black (nothing preserved). */
export function createMaskBuffer(
  width: number,
  height: number,
  fill: number = 0,
): MaskPixelBuffer {
  const data = new Uint8ClampedArray(width * height)
  if (fill !== 0) {
    data.fill(fill)
  }
  return { width, height, data }
}

export function cloneMaskBuffer(mask: MaskPixelBuffer): MaskPixelBuffer {
  return {
    width: mask.width,
    height: mask.height,
    data: new Uint8ClampedArray(mask.data),
  }
}

export function clearMaskBuffer(mask: MaskPixelBuffer, fill: number = 0): void {
  mask.data.fill(fill)
}

/** Write grayscale mask into an RGBA ImageData (R=G=B=value, A=255). */
export function maskToImageData(mask: MaskPixelBuffer): ImageData {
  const { width, height, data } = mask
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i]
    const offset = i * 4
    rgba[offset] = value
    rgba[offset + 1] = value
    rgba[offset + 2] = value
    rgba[offset + 3] = 255
  }
  return new ImageData(rgba, width, height)
}

/** Convert grayscale mask to an alpha ImageData for destination-in compositing. */
export function maskToAlphaImageData(mask: MaskPixelBuffer): ImageData {
  const { width, height, data } = mask
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 1) {
    const offset = i * 4
    rgba[offset] = 255
    rgba[offset + 1] = 255
    rgba[offset + 2] = 255
    rgba[offset + 3] = data[i]
  }
  return new ImageData(rgba, width, height)
}
