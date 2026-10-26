/**
 * Mirror BRIA RMBG-1.4 q8 ONNX + configs into public/models for same-origin
 * Safari loads (bg-remove-sdk worker patched by emitBgRemoveWorker.mts).
 *
 * Does not change the model family — still briaai/RMBG-1.4 quantized weights.
 *
 * Usage: npx tsx scripts/fetchRmbgBrowserWeights.mts
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const MODEL_ID = 'briaai/RMBG-1.4'
const HF_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/models',
  MODEL_ID,
)

/** Files transformers.js requests for dtype q8 (+ shared configs). */
const FILES: ReadonlyArray<{ rel: string; minBytes: number }> = [
  { rel: 'config.json', minBytes: 100 },
  { rel: 'preprocessor_config.json', minBytes: 50 },
  { rel: 'onnx/model_quantized.onnx', minBytes: 40_000_000 },
]

async function fetchWithRetry(url: string, attempts = 6): Promise<Response> {
  let last: unknown
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
      return res
    } catch (err) {
      last = err
      const wait = Math.min(30_000, 500 * 2 ** (i - 1))
      console.warn(`retry ${i}/${attempts} after ${wait}ms:`, err)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

async function ensureFile(rel: string, minBytes: number): Promise<void> {
  const dest = path.join(OUT, rel)
  mkdirSync(path.dirname(dest), { recursive: true })
  if (existsSync(dest) && statSync(dest).size >= minBytes) {
    console.log(`ok ${rel} (${statSync(dest).size} bytes, cached)`)
    return
  }
  const url = `${HF_BASE}/${rel}`
  console.log(`fetch ${rel}…`)
  const res = await fetchWithRetry(url)
  if (!res.body) throw new Error(`No body for ${url}`)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
  const size = statSync(dest).size
  if (size < minBytes) {
    throw new Error(`${rel} too small (${size} < ${minBytes})`)
  }
  console.log(`wrote ${rel} (${size} bytes)`)
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  for (const file of FILES) {
    await ensureFile(file.rel, file.minBytes)
  }
  writeFileSync(
    path.join(OUT, '.mirror-meta.json'),
    JSON.stringify(
      {
        modelId: MODEL_ID,
        dtype: 'q8',
        source: HF_BASE,
        files: FILES.map((f) => f.rel),
        fetchedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  console.log('RMBG-1.4 same-origin mirror ready at', OUT)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
