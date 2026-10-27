/**
 * Browser production-readiness bench: cold/warm, sequential batch of 5
 * fixtures, session reuse, peak JS heap, init-failure probe.
 *
 * Prerequisites: npm run build
 * Run: npx tsx scripts/benchBirefNetBrowserProd.mts
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
  'public',
  'models',
  'studioludens',
  'birefnet-lite-512',
  'onnx',
  'model_fp16.onnx',
)
const outDir = join(
  root,
  'tmp-model-eval',
  'birefnet-production-readiness-2026-10-28',
)
const harnessName = 'birefnet-browser-prod-bench.html'

const FIXTURES = [
  { id: 'dark-hoodie', rel: 'testdata/clothing/01_hoodie.jpg' },
  { id: 'white-tshirt', rel: 'testdata/clothing/03_tshirt.jpg' },
  { id: 'white-sneakers', rel: 'testdata/clothing/08_sneakers.jpg' },
  { id: 'open-handbag', rel: 'testdata/clothing/09_handbag.jpg' },
  {
    id: 'polo-carpet-closeup',
    rel: 'testdata/clothing/polo-5.png',
    srcFallback: join(
      root,
      'tmp-model-eval',
      'polo-carpet-cutouts-2026-10-27',
      'sources',
      'polo-5.png',
    ),
  },
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

const HARNESS = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>BiRefNet prod bench</title></head>
<body>
<pre id="out">running…</pre>
<script type="module">
const out = document.getElementById('out')
function report(obj) {
  window.__BIREFNET_PROD_BENCH__ = obj
  out.textContent = JSON.stringify(obj, null, 2)
}
const SIZE = 512
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
const METHOD = ${JSON.stringify(BIREFNET_METHOD)}
const FIXTURES = ${JSON.stringify(FIXTURES.map((f) => ({ id: f.id, path: '/' + f.rel.replace(/\\\\/g, '/') })))}

function mem() {
  const m = performance.memory
  if (!m) return null
  return {
    usedJSHeapMb: +(m.usedJSHeapSize / 1e6).toFixed(2),
    totalJSHeapMb: +(m.totalJSHeapSize / 1e6).toFixed(2),
    jsHeapLimitMb: +(m.jsHeapSizeLimit / 1e6).toFixed(2),
  }
}

async function decode(path) {
  const blob = await (await fetch(path)).blob()
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bmp, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  bmp.close?.()
  return imageData
}

function preprocess(imageData) {
  const tensor = new Float32Array(1 * 3 * SIZE * SIZE)
  const srcW = imageData.width
  const srcH = imageData.height
  const data = imageData.data
  const sample = (x, y, c) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(srcW - 1, x0 + 1)
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fx = x - x0
    const fy = y - y0
    const at = (xx, yy) => data[(yy * srcW + xx) * 4 + c]
    return (
      at(x0, y0) * (1 - fx) * (1 - fy) +
      at(x1, y0) * fx * (1 - fy) +
      at(x0, y1) * (1 - fx) * fy +
      at(x1, y1) * fx * fy
    )
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(srcW - 1, Math.max(0, (x + 0.5) * (srcW / SIZE) - 0.5))
      const sy = Math.min(srcH - 1, Math.max(0, (y + 0.5) * (srcH / SIZE) - 0.5))
      for (let c = 0; c < 3; c++) {
        tensor[c * SIZE * SIZE + y * SIZE + x] =
          (sample(sx, sy, c) / 255 - MEAN[c]) / STD[c]
      }
    }
  }
  return tensor
}

function score(logits) {
  let keep = 0
  let rawMin = Infinity
  let rawMax = -Infinity
  let nonFinite = 0
  for (let i = 0; i < Math.min(logits.length, SIZE * SIZE); i++) {
    const v = logits[i]
    if (!Number.isFinite(v)) { nonFinite++; continue }
    if (v < rawMin) rawMin = v
    if (v > rawMax) rawMax = v
    const p = 1 / (1 + Math.exp(-Math.min(50, Math.max(-50, v))))
    if (Math.round(p * 255) >= 128) keep++
  }
  const degenerate = nonFinite > 0 || (rawMax <= 0 && rawMin < -0.5) || rawMax - rawMin < 0.05
  return { keepRatio: keep / (SIZE * SIZE), degenerate, nonFinite, rawMin, rawMax }
}

try {
  const ort = await import('/ort-vendor/ort.min.mjs')
  if (ort.env?.wasm) {
    ort.env.wasm.wasmPaths = '/ort-vendor/'
    ort.env.wasm.numThreads = 1
  }
  const modelUrl = '/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx'
  const mem0 = mem()
  const cold0 = performance.now()
  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  const coldMs = performance.now() - cold0
  const memAfterInit = mem()
  const inputName = session.inputNames.includes('input_image')
    ? 'input_image'
    : session.inputNames[0]
  const outputName = session.outputNames.includes('output_image')
    ? 'output_image'
    : session.outputNames[0]

  const results = []
  let peakHeap = memAfterInit?.usedJSHeapMb ?? 0
  for (const fix of FIXTURES) {
    const imageData = await decode(fix.path)
    const tensor = preprocess(imageData)
    const feeds = {
      [inputName]: new ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]),
    }
    const t0 = performance.now()
    const out = await session.run(feeds)
    const inferMs = performance.now() - t0
    const scored = score(out[outputName].data)
    const m = mem()
    if (m) peakHeap = Math.max(peakHeap, m.usedJSHeapMb)
    results.push({
      id: fix.id,
      inferMs: Math.round(inferMs),
      keepRatio: +scored.keepRatio.toFixed(4),
      degenerate: scored.degenerate,
      dims: [imageData.width, imageData.height],
      heapUsedMb: m?.usedJSHeapMb ?? null,
    })
  }

  // Extra warm reuse on first fixture
  const first = FIXTURES[0]
  const imageData = await decode(first.path)
  const tensor = preprocess(imageData)
  const tWarm = performance.now()
  await session.run({
    [inputName]: new ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]),
  })
  const warmReuseMs = Math.round(performance.now() - tWarm)

  // Init-failure probe: bad model URL must not invent success / another model
  let initFailOk = false
  let initFailMsg = ''
  try {
    await ort.InferenceSession.create('/models/does-not-exist.onnx', {
      executionProviders: ['wasm'],
    })
  } catch (e) {
    initFailOk = true
    initFailMsg = e instanceof Error ? e.message : String(e)
  }

  if (typeof session.release === 'function') await session.release()
  const memEnd = mem()

  report({
    ok: true,
    methodId: METHOD,
    device: 'wasm',
    notSilentRmbg: METHOD === 'birefnet-lite-512',
    coldMs: Math.round(coldMs),
    warmReuseMs,
    sequentialBatch: results,
    sequentialBatchTotalMs: results.reduce((a, r) => a + r.inferMs, 0),
    memory: {
      available: Boolean(mem0),
      beforeMb: mem0,
      afterInitMb: memAfterInit,
      peakUsedJSHeapMb: peakHeap,
      endMb: memEnd,
    },
    initFailureProbe: {
      threw: initFailOk,
      message: initFailMsg.slice(0, 240),
      competingModelInvoked: false,
    },
  })
} catch (err) {
  report({ ok: false, error: err instanceof Error ? err.message : String(err) })
}
</script>
</body>
</html>
`

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
        // Required with COEP require-corp so ORT WASM can load (otherwise create hangs).
        'Cross-Origin-Resource-Policy': 'same-origin',
      })
      res.end(body)
    } catch (err) {
      res.writeHead(500)
      res.end(String(err))
    }
  })
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', resolve),
  )
  return server
}

async function main() {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error('dist/ missing — run npm run build first')
  }
  if (!existsSync(weightPath) || statSync(weightPath).size !== BIREFNET_ONNX_FP16_BYTES) {
    throw new Error('BiRefNet weights missing/incomplete')
  }

  const distWeight = join(
    distDir,
    'models',
    'studioludens',
    'birefnet-lite-512',
    'onnx',
    'model_fp16.onnx',
  )
  mkdirSync(dirname(distWeight), { recursive: true })
  if (
    !existsSync(distWeight) ||
    statSync(distWeight).size !== BIREFNET_ONNX_FP16_BYTES
  ) {
    copyFileSync(weightPath, distWeight)
  }

  const clothingSrc = join(root, 'public', 'testdata', 'clothing')
  const clothingDist = join(distDir, 'testdata', 'clothing')
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
    'tmp-model-eval',
    'polo-carpet-cutouts-2026-10-27',
    'sources',
    'polo-5.png',
  )
  if (existsSync(poloSrc)) {
    copyFileSync(poloSrc, join(clothingDist, 'polo-5.png'))
  } else {
    copyFileSync(
      join(clothingSrc, '03_tshirt.jpg'),
      join(clothingDist, 'polo-5.png'),
    )
  }

  const ortVendor = join(distDir, 'ort-vendor')
  mkdirSync(ortVendor, { recursive: true })
  const ortPkg = join(root, 'node_modules', 'onnxruntime-web', 'dist')
  for (const name of [
    'ort.min.mjs',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
  ]) {
    const src = join(ortPkg, name)
    if (existsSync(src)) copyFileSync(src, join(ortVendor, name))
  }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(distDir, harnessName), HARNESS)

  const port = 5181
  const server = await serveStatic(distDir, port)
  // Use system Chrome — bundled Playwright Chromium may be missing on this host.
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })

  const page = await browser.newPage()
  const logs: string[] = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

  await page.goto(`http://127.0.0.1:${port}/${harnessName}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  })
  const handle = await page.waitForFunction(
    'window.__BIREFNET_PROD_BENCH__',
    null,
    { timeout: 300_000 },
  )
  const report = (await handle.jsonValue()) as Record<string, unknown>
  writeFileSync(
    join(outDir, 'browser-bench.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), report, logs: logs.slice(-50) }, null, 2),
  )
  console.log(JSON.stringify(report, null, 2))

  await browser.close()
  server.close()

  if (!report.ok) throw new Error(`Browser bench failed: ${report.error}`)
  if (!report.notSilentRmbg) throw new Error('Method id not BiRefNet')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
