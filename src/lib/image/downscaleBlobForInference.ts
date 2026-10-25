import { loadHtmlImage } from './loadHtmlImage'

/** Long-edge cap before sending pixels into the on-device worker (mobile). */
export const MOBILE_INFERENCE_MAX_EDGE = 1600
/** Long-edge cap on desktop / large-memory environments. */
export const DESKTOP_INFERENCE_MAX_EDGE = 2560

export function isLikelyMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  if (navigator.maxTouchPoints > 1) return true
  if (typeof matchMedia === 'function') {
    try {
      if (matchMedia('(pointer: coarse)').matches) return true
    } catch {
      // ignore
    }
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

export function inferenceMaxEdgeForDevice(
  forceMobile?: boolean,
): number {
  const mobile =
    typeof forceMobile === 'boolean' ? forceMobile : isLikelyMobileBrowser()
  return mobile ? MOBILE_INFERENCE_MAX_EDGE : DESKTOP_INFERENCE_MAX_EDGE
}

/**
 * Optionally downscale a source image before SDK inference to reduce mobile
 * memory pressure. Output dimensions are returned so callers can map the
 * resulting alpha back to the original width×height (KEEP polarity unchanged).
 *
 * Does not mutate the original upload; creates a temporary decode + canvas.
 */
export async function downscaleBlobForInference(
  blob: Blob,
  sourceWidth: number,
  sourceHeight: number,
  options: { maxEdge?: number; forceMobile?: boolean } = {},
): Promise<{ blob: Blob; width: number; height: number; scaled: boolean }> {
  const maxEdge =
    options.maxEdge ?? inferenceMaxEdgeForDevice(options.forceMobile)
  const long = Math.max(sourceWidth, sourceHeight)
  if (long <= maxEdge || sourceWidth < 1 || sourceHeight < 1) {
    return {
      blob,
      width: sourceWidth,
      height: sourceHeight,
      scaled: false,
    }
  }

  const scale = maxEdge / long
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  const url = URL.createObjectURL(blob)
  try {
    const image = await loadHtmlImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return {
        blob,
        width: sourceWidth,
        height: sourceHeight,
        scaled: false,
      }
    }
    ctx.drawImage(image, 0, 0, width, height)

    const scaledBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (result) => resolve(result),
        'image/jpeg',
        0.92,
      )
    })

    if (!scaledBlob || scaledBlob.size === 0) {
      return {
        blob,
        width: sourceWidth,
        height: sourceHeight,
        scaled: false,
      }
    }

    return { blob: scaledBlob, width, height, scaled: true }
  } finally {
    URL.revokeObjectURL(url)
  }
}
