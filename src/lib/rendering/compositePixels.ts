/**
 * Pure pixel compositor used by tests and as the conceptual model for Canvas compositing.
 * Replacement BG: outputRGB = original * a + background * (1 - a); outputA = 255
 * Transparent: outputRGB = original; outputA = sourceA * maskA (premultiplied-friendly)
 */
export function compositePixelBuffers(
  originalRgba: Uint8ClampedArray,
  maskGray: Uint8ClampedArray,
  backgroundRgba: Uint8ClampedArray,
  options: { transparentBackground?: boolean } = {},
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(originalRgba.length)
  const transparent = options.transparentBackground === true
  for (let i = 0; i < maskGray.length; i += 1) {
    const maskA = maskGray[i]! / 255
    const o = i * 4
    if (transparent) {
      const sourceA = originalRgba[o + 3]! / 255
      out[o] = originalRgba[o]!
      out[o + 1] = originalRgba[o + 1]!
      out[o + 2] = originalRgba[o + 2]!
      out[o + 3] = Math.round(255 * sourceA * maskA)
      continue
    }
    out[o] = Math.round(
      originalRgba[o]! * maskA + backgroundRgba[o]! * (1 - maskA),
    )
    out[o + 1] = Math.round(
      originalRgba[o + 1]! * maskA + backgroundRgba[o + 1]! * (1 - maskA),
    )
    out[o + 2] = Math.round(
      originalRgba[o + 2]! * maskA + backgroundRgba[o + 2]! * (1 - maskA),
    )
    out[o + 3] = 255
  }
  return out
}
