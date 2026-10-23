/** sRGB → CIE Lab helpers (no OpenCV). Used by the documented seed fallback. */

export type Lab = { L: number; a: number; b: number }

function srgbToLinear(u: number): number {
  const c = u / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function xyzToLabChannel(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
}

/** OpenCV-compatible 8-bit Lab packing: L∈[0,255]≈L*255/100, a/b∈[0,255]≈a/b+128. */
export function rgbToLab8(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047
  const y = (0.2126729 * R + 0.7151522 * G + 0.072175 * B) / 1.0
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883
  const fx = xyzToLabChannel(x)
  const fy = xyzToLabChannel(y)
  const fz = xyzToLabChannel(z)
  const L = 116 * fy - 16
  const a = 500 * (fx - fy)
  const bb = 200 * (fy - fz)
  return {
    L: Math.max(0, Math.min(255, (L * 255) / 100)),
    a: Math.max(0, Math.min(255, a + 128)),
    b: Math.max(0, Math.min(255, bb + 128)),
  }
}

export function labDist(p: Lab, q: Lab): number {
  const dL = p.L - q.L
  const da = p.a - q.a
  const db = p.b - q.b
  return Math.sqrt(dL * dL + da * da + db * db)
}

/** Build packed Lab buffer (L,a,b per pixel) from RGBA ImageData. */
export function imageDataToLab8(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData
  const out = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4
    const lab = rgbToLab8(data[o]!, data[o + 1]!, data[o + 2]!)
    const d = i * 3
    out[d] = lab.L
    out[d + 1] = lab.a
    out[d + 2] = lab.b
  }
  return out
}
