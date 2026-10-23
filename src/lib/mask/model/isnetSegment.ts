/**
 * Local ONNX ISNet / IMG.LY background-removal entry.
 *
 * Produces a soft-alpha mask only — never mutates source RGB.
 * License: AGPL-3.0 (IMG.LY). Commercial use may need a paid license.
 */
import type { MaskPixelBuffer } from '../../../types/mask'
import { createMaskBuffer } from '../createMask'

export type IsnetNodeModelId = 'small' | 'medium' | 'large'

export type IsnetSegmentResult = {
  mask: MaskPixelBuffer
  methodUsed: 'isnet-onnx'
  modelId: string
  elapsedMs: number
  genuineModelInference: true
  runtime: 'node' | 'browser'
}

function isNodeRuntime(): boolean {
  // Prefer browser detection — Vite may polyfill `process` in the client.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return false
  }
  const g = globalThis as { process?: { versions?: { node?: string } } }
  return Boolean(g.process?.versions?.node)
}

export function maskFromRgba(
  width: number,
  height: number,
  rgba: Uint8Array | Buffer,
  srcW: number,
  srcH: number,
): MaskPixelBuffer {
  const mask = createMaskBuffer(width, height, 0)
  if (srcW === width && srcH === height) {
    for (let i = 0; i < mask.data.length; i += 1) {
      const o = i * 4
      const a = rgba[o + 3]!
      const g = (rgba[o]! + rgba[o + 1]! + rgba[o + 2]!) / 3
      mask.data[i] = a > 0 && a < 255 ? a : Math.round(Math.max(a, g))
    }
    return mask
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / width))
      const sy = Math.min(srcH - 1, Math.floor((y * srcH) / height))
      const o = (sy * srcW + sx) * 4
      const a = rgba[o + 3]!
      const g = (rgba[o]! + rgba[o + 1]! + rgba[o + 2]!) / 3
      mask.data[y * width + x] = a > 0 && a < 255 ? a : Math.round(Math.max(a, g))
    }
  }
  return mask
}

export type IsnetImageMime = 'image/png' | 'image/jpeg' | 'image/webp'

/**
 * Infer MIME from a filesystem path extension. Defaults to JPEG for unknown
 * photo extensions used by catalog scrapes (never returns empty).
 */
export function inferImageMimeFromPath(path: string): IsnetImageMime {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/jpeg'
}

/**
 * IMG.LY Node codec rejects Blobs with an empty `type` (`Unsupported format: `).
 * Raw Uint8Array/ArrayBuffer inputs are wrapped as typeless Blobs inside the
 * package — callers must supply an explicit image MIME.
 */
export function toIsnetInputBlob(
  bytes: Uint8Array,
  mime: IsnetImageMime,
): Blob {
  // Copy into a standalone ArrayBuffer — Blob parts reject SharedArrayBuffer views.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy], { type: mime })
}

/**
 * Normalize Node ISNet inputs. Typed image Blobs are reused as-is. Typeless or
 * non-image Blobs and bare byte buffers require an explicit MIME — never guess
 * empty type (IMG.LY would throw `Unsupported format: `).
 */
export function resolveIsnetInputBlob(
  input: Uint8Array | Blob,
  mime?: IsnetImageMime,
): Blob {
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    if (
      input.type === 'image/png' ||
      input.type === 'image/jpeg' ||
      input.type === 'image/webp'
    ) {
      return input
    }
    throw new Error(
      `ISNet input Blob has unsupported or empty type "${input.type}". Provide Uint8Array + mime image/png|jpeg|webp. Lab-seed was NOT used.`,
    )
  }
  if (!mime) {
    throw new Error(
      'ISNet Uint8Array input requires mime image/png|jpeg|webp. Lab-seed was NOT used.',
    )
  }
  return toIsnetInputBlob(input as Uint8Array, mime)
}

export function maskFromAlpha8(
  width: number,
  height: number,
  alpha: Uint8Array | Buffer,
  srcW: number,
  srcH: number,
): MaskPixelBuffer {
  const mask = createMaskBuffer(width, height, 0)
  if (srcW === width && srcH === height && alpha.length >= width * height) {
    for (let i = 0; i < mask.data.length; i += 1) {
      mask.data[i] = alpha[i]!
    }
    return mask
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / width))
      const sy = Math.min(srcH - 1, Math.floor((y * srcH) / height))
      mask.data[y * width + x] = alpha[sy * srcW + sx]!
    }
  }
  return mask
}

export async function segmentGarmentWithIsnetNode(
  imageData: ImageData,
  modelId: IsnetNodeModelId = 'medium',
  imagePath?: string,
): Promise<IsnetSegmentResult> {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const mod = await import('@imgly/background-removal-node')
  const { PNG } = await import('pngjs')

  let inputBytes: Uint8Array
  let mime: IsnetImageMime = 'image/png'
  if (imagePath) {
    const { readFileSync } = await import('node:fs')
    inputBytes = new Uint8Array(readFileSync(imagePath))
    mime = inferImageMimeFromPath(imagePath)
  } else {
    const png = new PNG({ width: imageData.width, height: imageData.height })
    png.data = Buffer.from(
      imageData.data.buffer,
      imageData.data.byteOffset,
      imageData.data.byteLength,
    )
    inputBytes = new Uint8Array(PNG.sync.write(png))
    mime = 'image/png'
  }

  // @imgly/background-removal-node wraps ArrayBuffer views as `new Blob([bytes])`
  // with an empty MIME type, then imageDecode throws `Unsupported format: `.
  // Always pass an explicit image MIME so sharp can decode the payload.
  const inputBlob = resolveIsnetInputBlob(inputBytes, mime)
  let blob: Blob | Buffer
  try {
    blob = await mod.removeBackground(inputBlob, {
      model: modelId === 'large' ? 'medium' : modelId,
      output: { format: 'image/png', quality: 1, type: 'mask' },
      debug: false,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `ISNet ONNX failed (${detail}). Input must be image/png|jpeg|webp with a MIME type; Lab-seed was NOT used as a silent substitute.`,
      { cause: err instanceof Error ? err : undefined },
    )
  }

  const buf = Buffer.isBuffer(blob)
    ? blob
    : Buffer.from(await (blob as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer())

  const decoded = PNG.sync.read(buf)
  let mask: MaskPixelBuffer
  if (decoded.data.length === decoded.width * decoded.height) {
    mask = maskFromAlpha8(
      imageData.width,
      imageData.height,
      decoded.data,
      decoded.width,
      decoded.height,
    )
  } else {
    mask = maskFromRgba(
      imageData.width,
      imageData.height,
      decoded.data,
      decoded.width,
      decoded.height,
    )
    let alphaVary = false
    for (let i = 0; i < decoded.width * decoded.height; i += 1) {
      if (decoded.data[i * 4 + 3]! < 250) {
        alphaVary = true
        break
      }
    }
    if (!alphaVary) {
      for (let i = 0; i < mask.data.length; i += 1) {
        const sx = Math.min(
          decoded.width - 1,
          Math.floor(((i % imageData.width) * decoded.width) / imageData.width),
        )
        const sy = Math.min(
          decoded.height - 1,
          Math.floor(
            (((i / imageData.width) | 0) * decoded.height) / imageData.height,
          ),
        )
        const mo = (sy * decoded.width + sx) * 4
        mask.data[i] = Math.round(
          (decoded.data[mo]! + decoded.data[mo + 1]! + decoded.data[mo + 2]!) / 3,
        )
      }
    }
  }

  void mime
  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    mask,
    methodUsed: 'isnet-onnx',
    modelId: `imgly-node:${modelId === 'large' ? 'medium' : modelId}`,
    elapsedMs: Math.round(t1 - t0),
    genuineModelInference: true,
    runtime: 'node',
  }
}

export type IsnetProgressEvent = {
  key: string
  current: number
  total: number
}

export type IsnetBrowserOptions = {
  /** Called during first-run WASM/ONNX asset download. */
  onProgress?: (event: IsnetProgressEvent) => void
  /**
   * Max wall time for one browser inference including first download.
   * Default 120s with local assets; CDN fallbacks are flaky under VPN.
   */
  timeoutMs?: number
}

/** Served from Vite `public/imgly-bg-data/1.7.0` (see scripts/fetchImglyBrowserData.mts). */
export const ISNET_LOCAL_PUBLIC_PATH = '/imgly-bg-data/1.7.0/'

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Prefer same-origin assets under /imgly-bg-data/ so Batch ISNet does not hang
 * on staticimgly.com (common with VPN). Falls back to the package CDN default.
 */
export async function resolveIsnetBrowserPublicPath(): Promise<{
  publicPath: string
  source: 'local' | 'cdn'
}> {
  try {
    const probe = await fetch(`${ISNET_LOCAL_PUBLIC_PATH}resources.json`, {
      method: 'GET',
      cache: 'no-cache',
    })
    if (probe.ok) {
      const json = (await probe.json()) as Record<string, unknown>
      if (json['/models/isnet_quint8']) {
        const origin =
          typeof window !== 'undefined' ? window.location.origin : ''
        return {
          publicPath: `${origin}${ISNET_LOCAL_PUBLIC_PATH}`,
          source: 'local',
        }
      }
    }
  } catch {
    // fall through to CDN
  }
  return {
    publicPath:
      'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/',
    source: 'cdn',
  }
}

export async function segmentGarmentWithIsnetBrowser(
  imageData: ImageData,
  modelId: 'isnet' | 'isnet_fp16' | 'isnet_quint8' = 'isnet_quint8',
  options: IsnetBrowserOptions = {},
): Promise<IsnetSegmentResult> {
  const t0 = performance.now()
  const report = (key: string, current: number, total: number) => {
    options.onProgress?.({ key, current, total })
  }
  report('stage:load-package', 0, 4)

  // Use a static specifier (no @vite-ignore) so Vite can resolve and bundle the
  // package. A dynamic string + vite-ignore makes the browser request a bare
  // module id at runtime → "package missing" even when node_modules has it.
  let removeBackground: (
    src: Blob,
    cfg?: Record<string, unknown>,
  ) => Promise<Blob>
  try {
    const mod = (await import('@imgly/background-removal')) as {
      default?: typeof removeBackground
      removeBackground?: typeof removeBackground
    }
    removeBackground = mod.default ?? mod.removeBackground!
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Browser ISNet failed to load (@imgly/background-removal / onnxruntime-web): ${detail}. Ensure deps are installed and restart the Vite dev server. Lab-seed was NOT used as a silent substitute.`,
      { cause: err instanceof Error ? err : undefined },
    )
  }
  if (typeof removeBackground !== 'function') {
    throw new Error(
      'Browser ISNet package did not export removeBackground. Lab-seed was NOT used.',
    )
  }

  report('stage:resolve-assets', 1, 4)
  const assets = await resolveIsnetBrowserPublicPath()
  if (assets.source === 'cdn') {
    report('stage:cdn-warning', 1, 4)
  }
  // Local assets: allow longer inference; CDN: fail faster so UI is not stuck.
  const timeoutMs =
    options.timeoutMs ?? (assets.source === 'local' ? 180_000 : 90_000)

  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.putImageData(imageData, 0, 0)
  const inputBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/png',
    )
  })

  report(
    assets.source === 'local'
      ? 'stage:infer-local'
      : 'stage:fetch-cdn-model',
    2,
    4,
  )

  // quint8 ≈ smaller download; cpu avoids flaky WebGPU hangs; mask skips RGB decode.
  let outBlob: Blob
  try {
    outBlob = await withTimeout(
      removeBackground(inputBlob, {
        publicPath: assets.publicPath,
        model: modelId,
        device: 'cpu',
        output: { format: 'image/png', type: 'mask' },
        progress: (key: string, current: number, total: number) => {
          report(key, current, total)
        },
      }),
      timeoutMs,
      assets.source === 'local'
        ? `Browser ISNet timed out after ${Math.round(timeoutMs / 1000)}s while running the local model. Switch Batch strategy to Lab-seed. Lab-seed was NOT used as a silent substitute.`
        : `Browser ISNet timed out after ${Math.round(timeoutMs / 1000)}s fetching models from CDN (staticimgly.com). Run \`npx tsx scripts/fetchImglyBrowserData.mts\` to vendor assets under public/imgly-bg-data, or switch Batch strategy to Lab-seed. Lab-seed was NOT used as a silent substitute.`,
    )
  } catch (err) {
    if (err instanceof Error && err.message.includes('timed out')) throw err
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Browser ISNet inference failed: ${detail}. Lab-seed was NOT used as a silent substitute.`,
      { cause: err instanceof Error ? err : undefined },
    )
  }

  report('stage:decode-mask', 3, 4)
  const bitmap = await createImageBitmap(outBlob)
  const outCanvas = document.createElement('canvas')
  outCanvas.width = imageData.width
  outCanvas.height = imageData.height
  const outCtx = outCanvas.getContext('2d')
  if (!outCtx) throw new Error('2d context unavailable')
  outCtx.clearRect(0, 0, imageData.width, imageData.height)
  outCtx.drawImage(bitmap, 0, 0, imageData.width, imageData.height)
  const out = outCtx.getImageData(0, 0, imageData.width, imageData.height)
  const mask = createMaskBuffer(imageData.width, imageData.height, 0)
  // Mask output may be grayscale in RGB or alpha — take the stronger signal.
  for (let i = 0; i < mask.data.length; i += 1) {
    const o = i * 4
    const a = out.data[o + 3]!
    const g = Math.round(
      (out.data[o]! + out.data[o + 1]! + out.data[o + 2]!) / 3,
    )
    mask.data[i] = a > 0 && a < 255 ? a : Math.max(a, g)
  }
  report('stage:done', 4, 4)

  return {
    mask,
    methodUsed: 'isnet-onnx',
    modelId: `imgly-web:${modelId}`,
    elapsedMs: Math.round(performance.now() - t0),
    genuineModelInference: true,
    runtime: 'browser',
  }
}

export async function segmentGarmentWithIsnet(
  imageData: ImageData,
  modelId: string = 'medium',
  imagePath?: string,
  options?: IsnetBrowserOptions,
): Promise<IsnetSegmentResult> {
  if (isNodeRuntime()) {
    const id = (['small', 'medium', 'large'].includes(modelId)
      ? modelId
      : 'medium') as IsnetNodeModelId
    return segmentGarmentWithIsnetNode(imageData, id, imagePath)
  }
  // Map Node-ish ids / defaults to the lightest browser model for batch UX.
  const id = (['isnet', 'isnet_fp16', 'isnet_quint8'].includes(modelId)
    ? modelId
    : 'isnet_quint8') as 'isnet' | 'isnet_fp16' | 'isnet_quint8'
  return segmentGarmentWithIsnetBrowser(imageData, id, options)
}
