/**
 * Download IMG.LY browser ISNet assets (CPU wasm + isnet_quint8) into
 * public/imgly-bg-data so Batch → ISNet does not depend on staticimgly.com
 * (VPN / flaky CDN hangs the UI with no progress).
 *
 * Usage: npx tsx scripts/fetchImglyBrowserData.mts
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

const VERSION = '1.7.0'
const BASE = `https://staticimgly.com/@imgly/background-removal-data/${VERSION}/dist/`
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/imgly-bg-data/1.7.0',
)

/** CPU device path (device:'cpu') — not the jsep/WebGPU variants. */
const NEED = [
  '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
  '/onnxruntime-web/ort-wasm-simd-threaded.mjs',
  '/models/isnet_quint8',
] as const

async function fetchWithRetry(
  url: string,
  attempts = 6,
): Promise<Response> {
  let last: unknown
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(url)
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

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  console.log('fetch resources.json…')
  const metaRes = await fetchWithRetry(`${BASE}resources.json`)
  const resources = (await metaRes.json()) as Record<
    string,
    { chunks: Array<{ name: string }>; size: number }
  >
  writeFileSync(
    path.join(OUT, 'resources.json'),
    JSON.stringify(resources, null, 2),
  )

  const names = new Set<string>()
  for (const key of NEED) {
    const entry = resources[key]
    if (!entry) throw new Error(`missing resource key ${key}`)
    for (const chunk of entry.chunks) names.add(chunk.name)
    console.log(`need ${key} (${entry.size} bytes, ${entry.chunks.length} chunks)`)
  }

  // Map chunk name → expected byte length from offsets.
  const expectedSize = new Map<string, number>()
  for (const key of NEED) {
    for (const chunk of resources[key]!.chunks as Array<{
      name: string
      offsets: [number, number]
    }>) {
      expectedSize.set(chunk.name, chunk.offsets[1] - chunk.offsets[0])
    }
  }

  let i = 0
  for (const name of names) {
    i += 1
    const dest = path.join(OUT, name)
    const want = expectedSize.get(name) ?? 0
    const have = existsSync(dest) ? statSync(dest).size : 0
    if (have === want && want > 0) {
      console.log(`[${i}/${names.size}] skip ${name.slice(0, 16)}… (${want} B)`)
      continue
    }
    console.log(
      `[${i}/${names.size}] get ${name.slice(0, 16)}… (have ${have}, want ${want})`,
    )
    const res = await fetchWithRetry(`${BASE}${name}`)
    if (!res.body) throw new Error(`no body for ${name}`)
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
    const got = statSync(dest).size
    if (want > 0 && got !== want) {
      throw new Error(`chunk ${name} size ${got} !== expected ${want}`)
    }
  }
  console.log('OK →', OUT)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
