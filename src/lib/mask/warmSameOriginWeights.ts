/**
 * Stream the same-origin RMBG q8 ONNX once so Safari's HTTP cache is warm
 * before bg-remove-sdk / transformers.js fetch the same URL.
 * Does not keep the 44MB buffer in JS heap after the stream ends.
 */

export const BG_REMOVE_Q8_WEIGHT_PATH =
  '/models/briaai/RMBG-1.4/onnx/model_quantized.onnx'

export type WarmWeightsProgress = {
  /** 0–1 while bytes arrive */
  ratio: number
  receivedBytes: number
  totalBytes: number
}

/**
 * Returns false when fetch is unavailable (SSR/tests) or the body cannot be
 * streamed — caller should still attempt SDK preload.
 */
export async function warmSameOriginQ8Weights(
  onProgress?: (event: WarmWeightsProgress) => void,
): Promise<boolean> {
  if (typeof fetch !== 'function') return false

  const url = new URL(
    BG_REMOVE_Q8_WEIGHT_PATH,
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost/',
  ).href

  const response = await fetch(url, {
    method: 'GET',
    // Prefer default over force-cache — Firefox can NetworkError when workers
    // later re-read large force-cached ONNX bodies from Cache Storage.
    cache: 'default',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(
      `Same-origin model weights HTTP ${response.status} at ${BG_REMOVE_Q8_WEIGHT_PATH}`,
    )
  }

  const totalHeader = Number(response.headers.get('content-length') || 0)
  const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : 0
  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    // No streaming — rely on browser having buffered the response.
    onProgress?.({ ratio: 1, receivedBytes: totalBytes, totalBytes })
    return true
  }

  const reader = body.getReader()
  let receivedBytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    receivedBytes += value?.byteLength ?? 0
    const ratio =
      totalBytes > 0 ? Math.min(0.99, receivedBytes / totalBytes) : 0
    onProgress?.({ ratio, receivedBytes, totalBytes })
  }
  onProgress?.({
    ratio: 1,
    receivedBytes,
    totalBytes: totalBytes || receivedBytes,
  })
  return true
}
