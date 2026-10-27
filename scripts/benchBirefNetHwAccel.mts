/**
 * Isolated hardware-accel EP bench for stock BiRefNet FP16.
 * Does NOT change production App / session defaults.
 *
 * Prerequisites: npm run build
 * Run: npx tsx scripts/benchBirefNetHwAccel.mts
 *
 * Writes: tmp-model-eval/birefnet-hw-accel-2026-10-28/
 */
import { createServer } from 'node:http'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import {
  BIREFNET_METHOD,
  BIREFNET_ONNX_FP16_BYTES,
} from '../src/lib/mask/birefNet/constants'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const weightPath = join(
  root,
  'public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx',
)
const outDir = join(root, 'tmp-model-eval/birefnet-hw-accel-2026-10-28')
const harnessName = 'birefnet-ep-bench-harness.html'
const harnessSrc = join(root, 'scripts', harnessName)

const GOLDEN_FIXTURES = [
  { id: 'dark-hoodie', rel: 'testdata/clothing/01_hoodie.jpg' },
  { id: 'white-tshirt', rel: 'testdata/clothing/03_tshirt.jpg' },
  { id: 'white-sneakers', rel: 'testdata/clothing/08_sneakers.jpg' },
  { id: 'open-handbag', rel: 'testdata/clothing/09_handbag.jpg' },
  { id: 'polo-carpet-closeup', rel: 'testdata/clothing/polo-5.png' },
]

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.onnx': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
}

async function serveStatic(rootPath: string, port: number) {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
      let rel = decodeURIComponent(url.pathname)
      if (rel === '/') rel = '/index.html'
      const filePath = join(rootPath, rel.replace(/^\//, ''))
      if (!filePath.startsWith(rootPath) || !existsSync(filePath)) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      const body = readFileSync(filePath)
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
        'Content-Length': String(body.length),
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      })
      res.end(body)
    } catch (err) {
      res.writeHead(500)
      res.end(String(err))
    }
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
  return server
}

async function runEp(
  port: number,
  ep: 'wasm' | 'webgpu' | 'webgl',
  fixtureRels: string[],
) {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ep === 'webgpu' ? ['--enable-unsafe-webgpu'] : [],
  })
  const page = await browser.newPage()
  const logs: string[] = []
  page.on('console', (msg) => {
    const t = msg.type()
    if (t === 'error' || t === 'warning') {
      logs.push(`[${t}] ${msg.text().slice(0, 400)}`)
    }
  })
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

  const qs = new URLSearchParams({
    ort: `/ort-vendor/ort.min.mjs`,
    wasmPaths: `/ort-vendor/`,
    model: `/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx`,
    fixtures: fixtureRels.map((r) => `/${r}`).join(','),
    method: BIREFNET_METHOD,
    ep,
  })
  await page.goto(`http://127.0.0.1:${port}/${harnessName}?${qs}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  })
  const handle = await page.waitForFunction(
    'window.__BIREFNET_EP_BENCH__',
    null,
    { timeout: 600_000 },
  )
  const report = (await handle.jsonValue()) as Record<string, unknown>
  await browser.close()
  return { report, logs: logs.slice(-60) }
}

async function main() {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error('dist/ missing — run npm run build first')
  }
  if (!existsSync(weightPath) || statSync(weightPath).size !== BIREFNET_ONNX_FP16_BYTES) {
    throw new Error('BiRefNet weights missing/incomplete')
  }

  mkdirSync(outDir, { recursive: true })

  const distWeight = join(
    distDir,
    'models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx',
  )
  mkdirSync(dirname(distWeight), { recursive: true })
  if (
    !existsSync(distWeight) ||
    statSync(distWeight).size !== BIREFNET_ONNX_FP16_BYTES
  ) {
    copyFileSync(weightPath, distWeight)
  }

  const clothingSrc = join(root, 'public/testdata/clothing')
  const clothingDist = join(distDir, 'testdata/clothing')
  mkdirSync(clothingDist, { recursive: true })
  for (const name of [
    '01_hoodie.jpg',
    '03_tshirt.jpg',
    '08_sneakers.jpg',
    '09_handbag.jpg',
  ]) {
    copyFileSync(join(clothingSrc, name), join(clothingDist, name))
  }
  const poloSrc = join(
    root,
    'tmp-model-eval/polo-carpet-hw-accel-2026-10-28/sources/polo-5.png',
  )
  const poloAlt = join(
    root,
    'tmp-model-eval/polo-carpet-cutouts-2026-10-27/sources/polo-5.png',
  )
  const poloPick = existsSync(poloSrc) ? poloSrc : poloAlt
  if (existsSync(poloPick)) {
    copyFileSync(poloPick, join(clothingDist, 'polo-5.png'))
  } else {
    copyFileSync(join(clothingSrc, '03_tshirt.jpg'), join(clothingDist, 'polo-5.png'))
  }

  const ortVendor = join(distDir, 'ort-vendor')
  mkdirSync(ortVendor, { recursive: true })
  const ortPkg = join(root, 'node_modules/onnxruntime-web/dist')
  for (const name of [
    'ort.min.mjs',
    'ort.webgpu.min.mjs',
    'ort.webgl.min.mjs',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
  ]) {
    const src = join(ortPkg, name)
    if (existsSync(src)) copyFileSync(src, join(ortVendor, name))
  }

  copyFileSync(harnessSrc, join(distDir, harnessName))

  const port = 5183
  const server = await serveStatic(distDir, port)
  const fixtureRels = GOLDEN_FIXTURES.map((f) => f.rel)

  const eps = ['wasm', 'webgpu', 'webgl'] as const
  const combined: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    experimental: true,
    productionPathUnchanged: true,
    ortWebVersion: '1.21.0',
    model: 'studioludens/birefnet-lite-512 FP16 (stock)',
    fixtures: GOLDEN_FIXTURES.map((f) => f.id),
  }

  for (const ep of eps) {
    console.log(`Running EP=${ep}…`)
    try {
      const { report, logs } = await runEp(port, ep, fixtureRels)
      combined[ep] = { report, logs }
      console.log(
        ep,
        'ok=',
        report.ok,
        'cold=',
        report.coldMs,
        'batchTotal=',
        report.sequentialBatchTotalMs,
        'meaningfulKeep=',
        report.meaningfulKeep,
      )
    } catch (err) {
      combined[ep] = {
        report: {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
        logs: [],
      }
      console.error(ep, 'failed', err)
    }
  }

  server.close()
  writeFileSync(join(outDir, 'ep-bench.json'), JSON.stringify(combined, null, 2))
  console.log('Wrote', join(outDir, 'ep-bench.json'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
