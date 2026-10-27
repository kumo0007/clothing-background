/**
 * Mirror BiRefNet_lite 512 browser ONNX (fp16) into public/models for
 * same-origin loads.
 *
 * Source: studioludens/birefnet-lite-512 (MIT) — re-export of
 * ZhengPeng7/BiRefNet_lite (MIT).
 *
 * Env:
 *   HF_ENDPOINT          Override HF host (default https://huggingface.co).
 *                        Official HF endpoint override; e.g. a corporate mirror
 *                        that speaks the same /REPO/resolve/main/… paths.
 *   BIREFNET_FETCH_TIMEOUT_MS   Per-attempt download timeout (default 600000).
 *   BIREFNET_FETCH_RETRIES      Bounded attempts (default 4, max 8).
 *   BIREFNET_FETCH_STRICT       If "1", exit 1 when weights cannot be fetched
 *                               (default soft-fail for offline CI builds).
 *
 * Usage: npx tsx scripts/fetchBirefNetBrowserWeights.mts
 * Manual: see tmp-model-eval/BIREFNET_WEIGHT_FETCH.md
 */
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const MODEL_ID = 'studioludens/birefnet-lite-512'
const DEFAULT_HF_HOST = 'https://huggingface.co'
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/models',
  MODEL_ID,
)

/**
 * Trusted SHA-256 from the Hugging Face Git LFS pointer for
 * onnx/model_fp16.onnx (oid sha256:…, size 98484532) at commit
 * 962e67969ec6acec9c19fab76acee4f5e22e990c.
 * Source: https://huggingface.co/studioludens/birefnet-lite-512/raw/main/onnx/model_fp16.onnx
 */
const FP16_SHA256 =
  'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516'
const FP16_BYTES = 98_484_532

type WeightFile = {
  rel: string
  minBytes: number
  /** Exact expected size when known from LFS (preferred over minBytes alone). */
  exactBytes?: number
  sha256?: string
}

const FILES: ReadonlyArray<WeightFile> = [
  { rel: 'config.json', minBytes: 20 },
  { rel: 'preprocessor_config.json', minBytes: 50 },
  { rel: 'LICENSE', minBytes: 50 },
  {
    rel: 'onnx/model_fp16.onnx',
    minBytes: FP16_BYTES,
    exactBytes: FP16_BYTES,
    sha256: FP16_SHA256,
  },
]

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function hfHost(): string {
  const raw = (process.env.HF_ENDPOINT || DEFAULT_HF_HOST).trim().replace(/\/$/, '')
  return raw || DEFAULT_HF_HOST
}

function resolveUrl(rel: string): string {
  return `${hfHost()}/${MODEL_ID}/resolve/main/${rel}`
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

function isComplete(file: WeightFile, dest: string): boolean {
  if (!existsSync(dest)) return false
  const size = statSync(dest).size
  if (file.exactBytes !== undefined && size !== file.exactBytes) return false
  if (size < file.minBytes) return false
  if (file.sha256) {
    const digest = sha256File(dest)
    if (digest !== file.sha256) {
      console.warn(
        `checksum mismatch for ${file.rel}: got ${digest}, expected ${file.sha256}`,
      )
      return false
    }
  }
  return true
}

function removeIfExists(filePath: string): void {
  if (existsSync(filePath)) unlinkSync(filePath)
}

async function fetchWithRetry(
  url: string,
  attempts: number,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  let last: unknown
  for (let i = 1; i <= attempts; i += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers,
      })
      clearTimeout(timer)
      if (!res.ok && res.status !== 206) {
        throw new Error(`${url} → HTTP ${res.status}`)
      }
      return res
    } catch (err) {
      clearTimeout(timer)
      last = err
      if (i >= attempts) break
      const wait = Math.min(30_000, 500 * 2 ** (i - 1))
      const detail = err instanceof Error ? err.message : String(err)
      console.warn(`retry ${i}/${attempts} after ${wait}ms: ${detail}`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

async function ensureFile(
  file: WeightFile,
  attempts: number,
  timeoutMs: number,
): Promise<void> {
  const dest = path.join(OUT, file.rel)
  const part = `${dest}.part`
  mkdirSync(path.dirname(dest), { recursive: true })

  if (isComplete(file, dest)) {
    console.log(`ok ${file.rel} (${statSync(dest).size} bytes, validated)`)
    return
  }

  if (existsSync(dest)) {
    console.warn(
      `removing invalid ${file.rel} (${statSync(dest).size} bytes)`,
    )
    unlinkSync(dest)
  }

  const url = resolveUrl(file.rel)
  const existingPart = existsSync(part) ? statSync(part).size : 0
  if (existingPart > 0) {
    console.log(`resume ${file.rel} from byte ${existingPart}…`)
  } else {
    console.log(`fetch ${file.rel} from ${url}…`)
  }

  const headers: Record<string, string> = {}
  if (existingPart > 0) headers.Range = `bytes=${existingPart}-`

  let res: Response
  try {
    res = await fetchWithRetry(url, attempts, timeoutMs, headers)
  } catch (err) {
    removeIfExists(part)
    throw err
  }
  if (!res.body) {
    removeIfExists(part)
    throw new Error(`No body for ${url}`)
  }
  // If server ignored Range, restart cleanly.
  if (existingPart > 0 && res.status === 200) {
    console.warn('server ignored Range — restarting full download')
    removeIfExists(part)
  }
  const append = existsSync(part) && res.status === 206

  try {
    await pipeline(
      Readable.fromWeb(res.body as never),
      createWriteStream(part, { flags: append ? 'a' : 'w' }),
    )
  } catch (err) {
    // Keep .part for resume on the next run.
    throw err
  }

  const size = statSync(part).size
  if (file.exactBytes !== undefined && size !== file.exactBytes) {
    removeIfExists(part)
    throw new Error(
      `${file.rel} size ${size} ≠ expected ${file.exactBytes} (incomplete or wrong file)`,
    )
  }
  if (size < file.minBytes) {
    removeIfExists(part)
    throw new Error(`${file.rel} too small (${size} < ${file.minBytes})`)
  }
  if (file.sha256) {
    const digest = sha256File(part)
    if (digest !== file.sha256) {
      removeIfExists(part)
      throw new Error(
        `${file.rel} SHA-256 mismatch: got ${digest}, expected ${file.sha256}`,
      )
    }
  }

  renameSync(part, dest)
  console.log(`wrote ${file.rel} (${size} bytes${file.sha256 ? ', sha256 ok' : ''})`)
}

function writeReadyMarker(ok: boolean, error?: string): void {
  writeFileSync(
    path.join(OUT, '.mirror-meta.json'),
    JSON.stringify(
      {
        modelId: MODEL_ID,
        baseModel: 'ZhengPeng7/BiRefNet_lite',
        license: 'MIT',
        inputSize: 512,
        hfHost: hfHost(),
        ready: ok,
        fp16: {
          rel: 'onnx/model_fp16.onnx',
          bytes: FP16_BYTES,
          sha256: FP16_SHA256,
        },
        mirroredAt: new Date().toISOString(),
        error: error ?? null,
        notes:
          'Browser-ready BiRefNet_lite ONNX. DIS5K training-data terms may still apply commercially. ready=false means BiRefNet must not be treated as available.',
      },
      null,
      2,
    ),
  )
}

async function main(): Promise<void> {
  const timeoutMs = envInt('BIREFNET_FETCH_TIMEOUT_MS', 600_000, 10_000, 3_600_000)
  const attempts = envInt('BIREFNET_FETCH_RETRIES', 4, 1, 8)
  const strict = process.env.BIREFNET_FETCH_STRICT === '1'

  mkdirSync(OUT, { recursive: true })
  console.log(`HF_ENDPOINT=${hfHost()}`)
  console.log(`timeout=${timeoutMs}ms retries=${attempts} strict=${strict}`)

  try {
    for (const file of FILES) {
      await ensureFile(file, attempts, timeoutMs)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    writeReadyMarker(false, message)
    console.warn('BiRefNet weight mirror incomplete:', message)
    console.warn(
      'See tmp-model-eval/BIREFNET_WEIGHT_FETCH.md for manual download + SHA-256 validation.',
    )
    if (strict) process.exit(1)
    return
  }

  writeReadyMarker(true)
  console.log('BiRefNet browser weights ready at', OUT)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
