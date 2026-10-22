/**
 * Pure pixel compositor used by tests and as the conceptual model for Canvas compositing.
 * alpha = mask/255; output = original * alpha + background * (1 - alpha)
 */
export function compositePixelBuffers(
  originalRgba: Uint8ClampedArray,
  maskGray: Uint8ClampedArray,
  backgroundRgba: Uint8ClampedArray,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(originalRgba.length)
  for (let i = 0; i < maskGray.length; i += 1) {
    const alpha = maskGray[i] / 255
    const o = i * 4
    out[o] = Math.round(originalRgba[o] * alpha + backgroundRgba[o] * (1 - alpha))
    out[o + 1] = Math.round(
      originalRgba[o + 1] * alpha + backgroundRgba[o + 1] * (1 - alpha),
    )
    out[o + 2] = Math.round(
      originalRgba[o + 2] * alpha + backgroundRgba[o + 2] * (1 - alpha),
    )
    out[o + 3] = 255
  }
  return out
}
