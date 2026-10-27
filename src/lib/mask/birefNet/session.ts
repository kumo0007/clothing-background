import type { InferenceSession, Tensor } from 'onnxruntime-web'
import {
  BIREFNET_INFER_TIMEOUT_MS,
  BIREFNET_INPUT_NAME,
  BIREFNET_INPUT_SIZE,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_PATH,
  BIREFNET_ONNX_FP32_PATH,
  BIREFNET_OUTPUT_NAME,
  BIREFNET_PRELOAD_IDLE_MS,
  BIREFNET_PRELOAD_MAX_MS,
} from './constants'
import { logitsLookDegenerate } from './postprocess'

export type BirefNetDevice = 'webgpu' | 'wasm'

export type BirefNetProgress =
  | {
      kind: 'birefnet-init'
      status: 'loading' | 'ready' | 'error'
      message?: string
      ratio?: number
      device?: BirefNetDevice
    }
  | {
      kind: 'birefnet-process'
      stage: string
      ratio?: number
    }

type OrtModule = typeof import('onnxruntime-web')

export type BirefNetSessionHandle = {
  session: InferenceSession
  device: BirefNetDevice
  inputName: string
  outputName: string
}

let ortModule: OrtModule | null = null
let shared: BirefNetSessionHandle | null = null
let preloadPromise: Promise<BirefNetSessionHandle> | null = null

/** Test seam — inject a fake session. */
export function setSharedBirefNetSessionForTests(
  handle: BirefNetSessionHandle | null,
): void {
  shared = handle
  preloadPromise = handle ? Promise.resolve(handle) : null
}

export function resetBirefNetSessionForTests(): void {
  shared = null
  preloadPromise = null
  ortModule = null
}

async function loadOrt(): Promise<OrtModule> {
  if (ortModule) return ortModule
  ortModule = await import('onnxruntime-web')
  // Multi-thread WASM needs SharedArrayBuffer + cross-origin isolation.
  // Without COOP/COEP, pin a single thread (portable; measured ~same or
  // slightly faster warm latency on this host than the default).
  const isolated =
    typeof globalThis !== 'undefined' &&
    'crossOriginIsolated' in globalThis &&
    Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated)
  if (ortModule.env?.wasm && !isolated) {
    ortModule.env.wasm.numThreads = 1
  }
  return ortModule
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function contentLengthOk(
  headers: Headers,
  expectedBytes?: number,
): boolean {
  if (expectedBytes === undefined) return true
  const raw =
    headers.get('content-length') || headers.get('Content-Length') || ''
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) {
    // Some static hosts omit length on HEAD — do not treat as ready for FP16.
    return false
  }
  return n === expectedBytes
}

/**
 * Probe same-origin weights. For fp16, require exact Content-Length so a
 * truncated .onnx is never treated as BiRefNet-available.
 */
async function probeModelUrl(
  url: string,
  expectedBytes?: number,
): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' })
    if (res.ok && contentLengthOk(res.headers, expectedBytes)) return true
    // Some hosts reject HEAD — try a ranged GET and trust Content-Range.
    const get = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-cache',
    })
    if (!(get.ok || get.status === 206)) return false
    if (expectedBytes === undefined) return true
    const range = get.headers.get('content-range') || ''
    const total = Number.parseInt(range.split('/')[1] || '', 10)
    if (Number.isFinite(total) && total > 0) {
      return total === expectedBytes
    }
    return contentLengthOk(get.headers, expectedBytes)
  } catch {
    return false
  }
}

export async function resolveBirefNetModelUrl(): Promise<{
  url: string
  precision: 'fp16' | 'fp32'
}> {
  if (await probeModelUrl(BIREFNET_ONNX_FP16_PATH, BIREFNET_ONNX_FP16_BYTES)) {
    return { url: BIREFNET_ONNX_FP16_PATH, precision: 'fp16' }
  }
  // FP32 is optional (~183 MB). No pinned SHA in-tree — accept any large body.
  try {
    const res = await fetch(BIREFNET_ONNX_FP32_PATH, {
      method: 'HEAD',
      cache: 'no-cache',
    })
    const len = Number.parseInt(res.headers.get('content-length') || '', 10)
    if (res.ok && Number.isFinite(len) && len >= 150_000_000) {
      return { url: BIREFNET_ONNX_FP32_PATH, precision: 'fp32' }
    }
  } catch {
    // ignore — fall through to missing-weights error
  }
  throw new Error(
    `BiRefNet weights missing or incomplete at ${BIREFNET_ONNX_FP16_PATH} (need ${BIREFNET_ONNX_FP16_BYTES} bytes). Run: npm run fetch:birefnet-weights`,
  )
}

type FetchBirefNetModelBytesFn = (
  url: string,
  expectedBytes: number | undefined,
  onProgress?: (event: BirefNetProgress) => void,
) => Promise<Uint8Array>

let fetchBirefNetModelBytesOverride: FetchBirefNetModelBytesFn | null = null

/** Test seam — avoid allocating the real ~94MB weight buffer in unit tests. */
export function setFetchBirefNetModelBytesForTests(
  fn: FetchBirefNetModelBytesFn | null,
): void {
  fetchBirefNetModelBytesOverride = fn
}

/**
 * Fetch ONNX bytes ourselves and validate length before handing them to ORT.
 * Passing a URL into InferenceSession.create lets ORT fetch again; Firefox then
 * often fails with "Content-Length header of network response exceeds response Body"
 * on large same-origin weights (compression / proxy / truncated body).
 */
export async function fetchBirefNetModelBytes(
  url: string,
  expectedBytes: number | undefined,
  onProgress?: (event: BirefNetProgress) => void,
): Promise<Uint8Array> {
  if (fetchBirefNetModelBytesOverride) {
    return fetchBirefNetModelBytesOverride(url, expectedBytes, onProgress)
  }
  onProgress?.({
    kind: 'birefnet-init',
    status: 'loading',
    message: 'Downloading BiRefNet weights…',
    ratio: 0.05,
  })
  const res = await fetch(url, { cache: 'force-cache' })
  if (!res.ok) {
    throw new Error(
      `BiRefNet weight download failed (HTTP ${res.status}) for ${url}`,
    )
  }

  // Prefer streaming read so we can detect early truncation vs Content-Length.
  const declared = Number.parseInt(
    res.headers.get('content-length') || res.headers.get('Content-Length') || '',
    10,
  )
  if (
    expectedBytes !== undefined &&
    Number.isFinite(declared) &&
    declared > 0 &&
    declared !== expectedBytes
  ) {
    throw new Error(
      `BiRefNet weight Content-Length is ${declared} bytes; expected ${expectedBytes}. Re-run npm run fetch:birefnet-weights.`,
    )
  }

  const buffer = await res.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) {
    throw new Error(
      `BiRefNet weight body is ${bytes.byteLength} bytes; expected ${expectedBytes}. ` +
        `Clear cache, hard-refresh, and re-run npm run fetch:birefnet-weights.`,
    )
  }
  if (bytes.byteLength < 1_000_000) {
    throw new Error(
      `BiRefNet weight body too small (${bytes.byteLength} bytes) at ${url}`,
    )
  }
  onProgress?.({
    kind: 'birefnet-init',
    status: 'loading',
    message: `BiRefNet weights ready (${Math.round(bytes.byteLength / (1024 * 1024))} MB)`,
    ratio: 0.35,
  })
  return bytes
}

async function createSession(
  ort: OrtModule,
  modelBytes: Uint8Array,
  preferWebGpu: boolean,
  onProgress?: (event: BirefNetProgress) => void,
): Promise<BirefNetSessionHandle> {
  const tryCreate = async (device: BirefNetDevice) => {
    onProgress?.({
      kind: 'birefnet-init',
      status: 'loading',
      message: `Loading BiRefNet (${device})…`,
      device,
    })
    // Pass bytes — never a URL — so ORT does not re-fetch and trip Firefox
    // Content-Length / truncated-body errors on the ~94MB ONNX.
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
      graphOptimizationLevel: 'all',
    })
    const inputName = session.inputNames.includes(BIREFNET_INPUT_NAME)
      ? BIREFNET_INPUT_NAME
      : session.inputNames[0]!
    const outputName = session.outputNames.includes(BIREFNET_OUTPUT_NAME)
      ? BIREFNET_OUTPUT_NAME
      : session.outputNames[0]!
    return { session, device, inputName, outputName }
  }

  if (preferWebGpu) {
    try {
      return await tryCreate('webgpu')
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      onProgress?.({
        kind: 'birefnet-init',
        status: 'loading',
        message: `WebGPU unavailable (${detail.slice(0, 80)}); trying WASM…`,
        device: 'wasm',
      })
    }
  }
  return tryCreate('wasm')
}

/**
 * Lazy-load and cache a shared BiRefNet ONNX session (WebGPU → WASM).
 */
export async function preloadBirefNetModel(
  onProgress?: (event: BirefNetProgress) => void,
): Promise<BirefNetSessionHandle> {
  if (shared) {
    onProgress?.({
      kind: 'birefnet-init',
      status: 'ready',
      device: shared.device,
      message: 'BiRefNet ready',
    })
    return shared
  }
  if (preloadPromise) return preloadPromise

  preloadPromise = (async () => {
    const t0 = Date.now()
    const ort = await loadOrt()
    const { url, precision } = await resolveBirefNetModelUrl()
    onProgress?.({
      kind: 'birefnet-init',
      status: 'loading',
      message: `Downloading BiRefNet ${precision} (~94 MB)…`,
      ratio: 0.05,
    })

    const expectedBytes =
      precision === 'fp16' ? BIREFNET_ONNX_FP16_BYTES : undefined
    const modelBytes = await fetchBirefNetModelBytes(
      url,
      expectedBytes,
      onProgress,
    )

    // Prefer WASM by default: several Chrome WebGPU adapters load this ONNX
    // successfully but emit degenerate all-negative logits. WebGPU can still
    // be forced with VITE_BIREFNET_WEBGPU=1; runBirefNetInference also falls
    // back WASM if a WebGPU run looks broken.
    const preferWebGpu =
      import.meta.env?.VITE_BIREFNET_WEBGPU === '1' &&
      typeof navigator !== 'undefined' &&
      'gpu' in navigator

    const handle = await withTimeout(
      createSession(ort, modelBytes, preferWebGpu, onProgress),
      BIREFNET_PRELOAD_MAX_MS,
      `BiRefNet load timed out after ${Math.round(BIREFNET_PRELOAD_MAX_MS / 1000)}s. Stay on Wi‑Fi and keep this tab open.`,
    )

    // Soft idle warning — createSession already finished; just note elapsed.
    const elapsed = Date.now() - t0
    if (elapsed > BIREFNET_PRELOAD_IDLE_MS) {
      onProgress?.({
        kind: 'birefnet-init',
        status: 'loading',
        message: `BiRefNet load took ${Math.round(elapsed / 1000)}s`,
        device: handle.device,
      })
    }

    shared = handle
    onProgress?.({
      kind: 'birefnet-init',
      status: 'ready',
      device: handle.device,
      message: 'BiRefNet ready',
      ratio: 1,
    })
    return handle
  })().catch((err) => {
    preloadPromise = null
    shared = null
    onProgress?.({
      kind: 'birefnet-init',
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
    throw err
  })

  return preloadPromise
}

async function runOnce(
  ort: OrtModule,
  handle: BirefNetSessionHandle,
  input: Float32Array,
): Promise<{ logits: Float32Array; width: number; height: number }> {
  const tensor = new ort.Tensor('float32', input, [
    1,
    3,
    BIREFNET_INPUT_SIZE,
    BIREFNET_INPUT_SIZE,
  ])
  const feeds: Record<string, Tensor> = {
    [handle.inputName]: tensor,
  }
  const outputs: Record<string, Tensor> = await withTimeout(
    handle.session.run(feeds),
    BIREFNET_INFER_TIMEOUT_MS,
    `BiRefNet inference timed out after ${Math.round(BIREFNET_INFER_TIMEOUT_MS / 1000)}s (${handle.device}).`,
  )
  const out = outputs[handle.outputName]
  if (!out) {
    throw new Error(
      `BiRefNet missing output tensor "${handle.outputName}". Got: ${Object.keys(outputs).join(', ')}`,
    )
  }
  const data = out.data
  let logits: Float32Array
  if (data instanceof Float32Array) {
    logits = data
  } else if (ArrayBuffer.isView(data)) {
    logits = Float32Array.from(data as unknown as ArrayLike<number>)
  } else {
    throw new Error('BiRefNet output is not a typed array.')
  }
  const dims = out.dims.map((d: number) => Number(d))
  let width = BIREFNET_INPUT_SIZE
  let height = BIREFNET_INPUT_SIZE
  if (dims.length >= 2) {
    height = dims[dims.length - 2] || height
    width = dims[dims.length - 1] || width
  }
  return { logits, width, height }
}

/** Drop shared session and rebuild WASM-only (WebGPU quality fallback). */
export async function rebuildBirefNetSessionWasmOnly(
  onProgress?: (event: BirefNetProgress) => void,
): Promise<BirefNetSessionHandle> {
  await disposeBirefNetSession()
  const ort = await loadOrt()
  const { url, precision } = await resolveBirefNetModelUrl()
  onProgress?.({
    kind: 'birefnet-init',
    status: 'loading',
    message: 'WebGPU BiRefNet output looked broken — reloading WASM…',
    device: 'wasm',
  })
  const expectedBytes =
    precision === 'fp16' ? BIREFNET_ONNX_FP16_BYTES : undefined
  const modelBytes = await fetchBirefNetModelBytes(
    url,
    expectedBytes,
    onProgress,
  )
  const handle = await createSession(ort, modelBytes, false, onProgress)
  shared = handle
  preloadPromise = Promise.resolve(handle)
  onProgress?.({
    kind: 'birefnet-init',
    status: 'ready',
    device: 'wasm',
    message: 'BiRefNet ready (WASM)',
    ratio: 1,
  })
  return handle
}

export async function runBirefNetInference(
  input: Float32Array,
  onProgress?: (event: BirefNetProgress) => void,
): Promise<{
  logits: Float32Array
  width: number
  height: number
  device: BirefNetDevice
  fallbackReason?: string
}> {
  const ort = await loadOrt()
  let handle = await preloadBirefNetModel(onProgress)
  onProgress?.({
    kind: 'birefnet-process',
    stage: `Running BiRefNet (${handle.device})…`,
  })

  let result = await runOnce(ort, handle, input)
  let fallbackReason: string | undefined

  if (handle.device === 'webgpu' && logitsLookDegenerate(result.logits)) {
    fallbackReason =
      'WebGPU produced degenerate logits (empty KEEP risk); retried with WASM'
    onProgress?.({
      kind: 'birefnet-process',
      stage: fallbackReason,
    })
    handle = await rebuildBirefNetSessionWasmOnly(onProgress)
    onProgress?.({
      kind: 'birefnet-process',
      stage: 'Running BiRefNet (wasm)…',
    })
    result = await runOnce(ort, handle, input)
    if (logitsLookDegenerate(result.logits)) {
      throw new Error(
        'BiRefNet WASM retry also produced degenerate logits. Treating as inference failure.',
      )
    }
  }

  return { ...result, device: handle.device, fallbackReason }
}

/** Release the shared session (best-effort). */
export async function disposeBirefNetSession(): Promise<void> {
  const current = shared
  shared = null
  preloadPromise = null
  if (current?.session && 'release' in current.session) {
    try {
      await (current.session as { release?: () => Promise<void> }).release?.()
    } catch {
      // ignore
    }
  }
}
