/**
 * Production-readiness browser review for experimental GatherND rewrite.
 * Does NOT enable rewrite in production. Serves rewrite from isolated URL only.
 *
 * Covers: hard-case quality, repeated lifecycle/memory, browser matrix,
 * WebGPU-unavailable graceful path.
 *
 * Run: npx tsx experiments/birefnet-webgpu-rewrite/review_browser_readiness.mts
 */
import { createServer, type Server } from 'node:http'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit, type Browser } from 'playwright-core'
import {
  BIREFNET_METHOD,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_SHA256,
} from '../../src/lib/mask/birefNet/constants'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const distDir = join(root, 'dist')
const stockPath = join(
  root,
  'public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx',
)
const rewritePath = join(
  root,
  'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/model_fp16.gathernd_rewrite.onnx',
)
const outDir = join(
  root,
  'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/production-readiness',
)
const REWRITE_URL =
  '/experiments/birefnet-webgpu-rewrite/model_fp16.gathernd_rewrite.onnx'
const HARNESS = 'birefnet-rewrite-readiness-harness.html'
const PORT = 5186

/** Difficult / representative clothing cases for expanded quality review. */
const HARD_CASES = [
  {
    id: 'white-tshirt-light-bg',
    rel: 'testdata/clothing/03_tshirt.jpg',
    tags: ['white-garment', 'light-background', 'low-contrast-edge'],
  },
  {
    id: 'white-sneakers',
    rel: 'testdata/clothing/08_sneakers.jpg',
    tags: ['sneakers', 'white-on-light', 'fine-edge'],
  },
  {
    id: 'open-handbag-handles',
    rel: 'testdata/clothing/09_handbag.jpg',
    tags: ['handbag', 'thin-handles'],
  },
  {
    id: 'slip-dress-low-contrast',
    rel: 'testdata/clothing/07_slip_dress.jpg',
    tags: ['low-contrast-edge', 'drape'],
  },
  {
    id: 'polo-carpet-1',
    rel: 'testdata/clothing/polo-1.png',
    tags: ['carpet-background', 'polo'],
  },
  {
    id: 'polo-carpet-5-closeup',
    rel: 'testdata/clothing/polo-5.png',
    tags: ['carpet-background', 'closeup', 'low-contrast-edge'],
  },
  {
    id: 'polo-carpet-6-hem',
    rel: 'testdata/clothing/polo-6.jpg',
    tags: ['carpet-background', 'hard-case', 'hem'],
  },
  {
    id: 'polo-carpet-8-tape',
    rel: 'testdata/clothing/polo-8.jpg',
    tags: ['carpet-background', 'hard-case', 'tape'],
  },
  {
    id: 'dark-hoodie',
    rel: 'testdata/clothing/01_hoodie.jpg',
    tags: ['baseline'],
  },
  {
    id: 'coat',
    rel: 'testdata/clothing/05_coat.jpg',
    tags: ['outerwear'],
  },
]

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
}

const HARNESS_HTML = `<!doctype html><html><body><pre id="out">…</pre>
<script type="module">
const params = new URLSearchParams(location.search)
const mode = params.get('mode') || 'quality'
const modelUrl = params.get('model')
const fixturesCsv = params.get('fixtures') || ''
const forceNoGpu = params.get('forceNoGpu') === '1'
const repeats = Math.max(1, Number(params.get('repeats') || '1'))
const SIZE = 512
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

function report(o) {
  window.__READY__ = o
  document.getElementById('out').textContent = JSON.stringify(o, null, 2)
}
function mem() {
  const m = performance.memory
  if (!m) return null
  return {
    usedJSHeapMb: +(m.usedJSHeapSize / 1e6).toFixed(2),
    totalJSHeapMb: +(m.totalJSHeapSize / 1e6).toFixed(2),
  }
}
async function decode(path) {
  const bmp = await createImageBitmap(await (await fetch(path)).blob())
  const c = document.createElement('canvas')
  c.width = bmp.width; c.height = bmp.height
  const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0)
  const id = ctx.getImageData(0, 0, c.width, c.height)
  bmp.close?.()
  return id
}
function preprocess(imageData) {
  const tensor = new Float32Array(3 * SIZE * SIZE)
  const { width: srcW, height: srcH, data } = imageData
  const sample = (x, y, c) => {
    const x0 = Math.floor(x), y0 = Math.floor(y)
    const x1 = Math.min(srcW - 1, x0 + 1), y1 = Math.min(srcH - 1, y0 + 1)
    const fx = x - x0, fy = y - y0
    const at = (xx, yy) => data[(yy * srcW + xx) * 4 + c]
    return at(x0,y0)*(1-fx)*(1-fy)+at(x1,y0)*fx*(1-fy)+at(x0,y1)*(1-fx)*fy+at(x1,y1)*fx*fy
  }
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const sx = Math.min(srcW - 1, Math.max(0, (x + 0.5) * (srcW / SIZE) - 0.5))
    const sy = Math.min(srcH - 1, Math.max(0, (y + 0.5) * (srcH / SIZE) - 0.5))
    for (let c = 0; c < 3; c++)
      tensor[c * SIZE * SIZE + y * SIZE + x] = (sample(sx, sy, c) / 255 - MEAN[c]) / STD[c]
  }
  return tensor
}
function score(logits) {
  let rawMin = Infinity, rawMax = -Infinity, nonFinite = 0, keep = 0
  const n = Math.min(SIZE * SIZE, logits.length)
  for (let i = 0; i < n; i++) {
    let v = logits[i]
    if (!Number.isFinite(v)) { nonFinite++; v = 0 }
    if (v < rawMin) rawMin = v
    if (v > rawMax) rawMax = v
    const p = 1 / (1 + Math.exp(-Math.min(50, Math.max(-50, v))))
    if (Math.round(p * 255) >= 128) keep++
  }
  const degenerate =
    nonFinite > 0 || (rawMax <= 0 && rawMin < -0.5) || rawMax - rawMin < 0.05
  let fp = 0
  for (let i = 0; i < n; i += 1024) fp = (fp * 31 + ((logits[i] * 1000) | 0)) | 0
  return {
    keepRatio: +(keep / (SIZE * SIZE)).toFixed(4),
    rawMin, rawMax, nonFinite, degenerate, fingerprint: fp,
  }
}
function keepMask(logits) {
  const m = new Uint8Array(SIZE * SIZE)
  for (let i = 0; i < m.length; i++) {
    const v = logits[i]
    const p = 1 / (1 + Math.exp(-Math.min(50, Math.max(-50, Number.isFinite(v) ? v : 0))))
    m[i] = Math.round(p * 255) >= 128 ? 255 : 0
  }
  return m
}
function iou(a, b) {
  let inter = 0, union = 0, fr = 0, bl = 0
  for (let i = 0; i < a.length; i++) {
    const r = a[i] === 255, h = b[i] === 255
    if (r || h) union++
    if (r && h) inter++
    if (r && !h) fr++
    if (!r && h) bl++
  }
  return {
    iou: union === 0 ? 1 : inter / union,
    falseGarmentRemovalPct: +(100 * fr / a.length).toFixed(4),
    backgroundLeakagePct: +(100 * bl / a.length).toFixed(4),
  }
}

async function loadOrt(ep) {
  const entry = ep === 'webgpu' ? '/ort-vendor/ort.webgpu.min.mjs' : '/ort-vendor/ort.min.mjs'
  const ort = await import(entry)
  if (ort.env?.wasm) {
    ort.env.wasm.wasmPaths = '/ort-vendor/'
    ort.env.wasm.numThreads = 1
  }
  return ort
}

async function createSession(ort, ep) {
  return ort.InferenceSession.create(modelUrl, {
    executionProviders: [ep],
    graphOptimizationLevel: 'all',
  })
}

async function runInfer(ort, sess, path) {
  const image = await decode(path)
  const tensor = preprocess(image)
  const inName = sess.inputNames.includes('input_image') ? 'input_image' : sess.inputNames[0]
  const outName = sess.outputNames.includes('output_image') ? 'output_image' : sess.outputNames[0]
  const t0 = performance.now()
  const out = await sess.run({ [inName]: new ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]) })
  const ms = performance.now() - t0
  const logits = out[outName].data
  return { ms, logits, scored: score(logits), mask: keepMask(logits), dims: [image.width, image.height] }
}

try {
  if (forceNoGpu && 'gpu' in navigator) {
    try { delete navigator.gpu } catch (_) {
      Object.defineProperty(navigator, 'gpu', { get: () => undefined, configurable: true })
    }
  }

  const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu
  const fixtures = fixturesCsv.split(',').filter(Boolean)

  if (mode === 'probe') {
    let adapter = null
    let adapterError = null
    if (hasGpu) {
      try {
        adapter = await navigator.gpu.requestAdapter()
        adapter = adapter ? {
          vendor: adapter.info?.vendor || null,
          architecture: adapter.info?.architecture || null,
          description: adapter.info?.description || null,
        } : null
      } catch (e) {
        adapterError = String(e && e.message || e)
      }
    }
    report({
      ok: true,
      mode: 'probe',
      userAgent: navigator.userAgent,
      hasGpu,
      adapter,
      adapterError,
      crossOriginIsolated: !!globalThis.crossOriginIsolated,
    })
  } else if (mode === 'unavailable') {
    // Product fallback path: if WebGPU is missing OR forceNoGpu=1, only WASM may run.
    // Must yield a valid mask — never invent KEEP=0 / never skip assertUsable semantics.
    let webgpuError = null
    if (forceNoGpu) {
      webgpuError = 'forced WASM-only (simulates init policy when WebGPU disabled/unavailable)'
    } else if (!hasGpu) {
      webgpuError = 'navigator.gpu missing'
    } else {
      webgpuError = 'gpu present but unavailable-mode still validates WASM-only fallback'
    }
    const ortWasm = await loadOrt('wasm')
    const sess = await createSession(ortWasm, 'wasm')
    const path = fixtures[0]
    const r = await runInfer(ortWasm, sess, path)
    const wasmOk = !r.scored.degenerate && r.scored.keepRatio > 0.02
    if (typeof sess.release === 'function') await sess.release()
    report({
      ok: wasmOk,
      mode: 'unavailable',
      hasGpu,
      forceNoGpu,
      webgpuError,
      wasmFallback: { ok: wasmOk, keepRatio: r.scored.keepRatio, degenerate: r.scored.degenerate },
      didNotAcceptInvalidMask: wasmOk,
      didNotUseWebGpuInThisMode: true,
      note: 'Mirrors production policy: prefer WASM when WebGPU unavailable; unit tests cover degenerate-WebGPU → WASM rebuild',
    })
  } else if (mode === 'lifecycle') {
    const ort = await loadOrt('webgpu')
    if (!hasGpu) throw new Error('lifecycle requires WebGPU')
    const cold0 = performance.now()
    const sess = await createSession(ort, 'webgpu')
    const coldMs = performance.now() - cold0
    const path = fixtures[0]
    const heaps = []
    const keeps = []
    const fps = []
    const times = []
    let peak = mem()?.usedJSHeapMb || 0
    for (let i = 0; i < repeats; i++) {
      const r = await runInfer(ort, sess, path)
      keeps.push(r.scored.keepRatio)
      fps.push(r.scored.fingerprint)
      times.push(Math.round(r.ms))
      const m = mem()
      if (m) {
        heaps.push(m.usedJSHeapMb)
        peak = Math.max(peak, m.usedJSHeapMb)
      }
      if (r.scored.degenerate || r.scored.keepRatio < 0.02) {
        throw new Error('invalid mask during lifecycle at iter ' + i)
      }
    }
    // Second fixture batch once warm
    const batchTimes = []
    for (const p of fixtures.slice(0, 5)) {
      const r = await runInfer(ort, sess, p)
      batchTimes.push(Math.round(r.ms))
      if (r.scored.degenerate || r.scored.keepRatio < 0.02) {
        throw new Error('invalid mask in batch ' + p)
      }
    }
    if (typeof sess.release === 'function') await sess.release()
    const uniqueFp = new Set(fps).size
    const keepSpan = Math.max(...keeps) - Math.min(...keeps)
    const heapGrowth = heaps.length >= 2 ? heaps[heaps.length - 1] - heaps[0] : null
    report({
      ok: keepSpan < 0.001 && uniqueFp === 1,
      mode: 'lifecycle',
      coldMs: Math.round(coldMs),
      repeats,
      inferMs: times,
      warmMedianMs: [...times].sort((a,b)=>a-b)[Math.floor(times.length/2)],
      batch5Ms: batchTimes,
      batch5TotalMs: batchTimes.reduce((a,b)=>a+b,0),
      keepRatios: keeps,
      keepSpan,
      fingerprintStable: uniqueFp === 1,
      fingerprints: fps,
      heapUsedMbSeries: heaps,
      heapGrowthMb: heapGrowth,
      peakUsedJSHeapMb: peak,
      endMem: mem(),
      note: 'Same input must be stable; JS heap growth is a coarse proxy (GPU VRAM not exposed)',
    })
  } else if (mode === 'quality') {
    const ortWasm = await loadOrt('wasm')
    const ortGpu = await loadOrt('webgpu')
    if (!hasGpu) throw new Error('quality compare requires WebGPU')
    const wasmS = await createSession(ortWasm, 'wasm')
    const gpuS = await createSession(ortGpu, 'webgpu')
    const rows = []
    for (const path of fixtures) {
      const a = await runInfer(ortWasm, wasmS, path)
      const b = await runInfer(ortGpu, gpuS, path)
      const m = iou(a.mask, b.mask)
      rows.push({
        path,
        wasm: { ...a.scored, ms: Math.round(a.ms), dims: a.dims },
        webgpu: { ...b.scored, ms: Math.round(b.ms) },
        ...m,
        invalid: a.scored.degenerate || b.scored.degenerate || b.scored.keepRatio < 0.02,
      })
    }
    if (typeof wasmS.release === 'function') await wasmS.release()
    if (typeof gpuS.release === 'function') await gpuS.release()
    report({
      ok: rows.every((r) => !r.invalid && r.iou >= 0.99),
      mode: 'quality',
      rows,
      minIou: Math.min(...rows.map((r) => r.iou)),
      maxFalseRemoval: Math.max(...rows.map((r) => r.falseGarmentRemovalPct)),
      maxBgLeak: Math.max(...rows.map((r) => r.backgroundLeakagePct)),
    })
  } else {
    throw new Error('unknown mode ' + mode)
  }
} catch (e) {
  report({ ok: false, error: String(e && e.message || e), mode })
}
</script></body></html>`

async function prepareDist() {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error('dist/ missing — run npm run build first')
  }
  const stock = readFileSync(stockPath)
  const sha = createHash('sha256').update(stock).digest('hex')
  if (stock.length !== BIREFNET_ONNX_FP16_BYTES || sha !== BIREFNET_ONNX_FP16_SHA256) {
    throw new Error('stock integrity failed')
  }
  if (!existsSync(rewritePath)) throw new Error('missing rewrite onnx')

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(distDir, HARNESS), HARNESS_HTML)

  const clothingSrc = join(root, 'public/testdata/clothing')
  const clothingDist = join(distDir, 'testdata/clothing')
  mkdirSync(clothingDist, { recursive: true })
  const poloSrcDir = join(
    root,
    'tmp-model-eval/polo-carpet-hw-accel-2026-10-28/sources',
  )
  for (const c of HARD_CASES) {
    const name = c.rel.split('/').pop()!
    const candidates = [
      join(clothingSrc, name),
      join(poloSrcDir, name),
      join(
        root,
        'tmp-model-eval/polo-carpet-hw-accel-2026-10-28/sources',
        name,
      ),
    ]
    const src = candidates.find((p) => existsSync(p))
    if (!src) {
      throw new Error(`missing hard-case fixture: ${name}`)
    }
    copyFileSync(src, join(clothingDist, name))
  }

  const ortVendor = join(distDir, 'ort-vendor')
  mkdirSync(ortVendor, { recursive: true })
  const ortPkg = join(root, 'node_modules/onnxruntime-web/dist')
  for (const name of [
    'ort.min.mjs',
    'ort.webgpu.min.mjs',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
  ]) {
    const src = join(ortPkg, name)
    if (existsSync(src)) copyFileSync(src, join(ortVendor, name))
  }
}

async function serve(): Promise<Server> {
  const rewriteBytes = readFileSync(rewritePath)
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
      let rel = decodeURIComponent(url.pathname)
      if (rel === REWRITE_URL) {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(rewriteBytes.length),
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Resource-Policy': 'same-origin',
        })
        res.end(rewriteBytes)
        return
      }
      const filePath = join(distDir, rel.replace(/^\//, ''))
      if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
        res.writeHead(404)
        res.end('nf')
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
    } catch (e) {
      res.writeHead(500)
      res.end(String(e))
    }
  })
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r))
  return server
}

async function launchBrowser(
  kind: 'chrome' | 'edge' | 'firefox' | 'webkit',
  webgpu: boolean,
): Promise<Browser | null> {
  try {
    if (kind === 'chrome') {
      return await chromium.launch({
        headless: true,
        channel: 'chrome',
        args: webgpu ? ['--enable-unsafe-webgpu'] : [],
      })
    }
    if (kind === 'edge') {
      return await chromium.launch({
        headless: true,
        channel: 'msedge',
        args: webgpu ? ['--enable-unsafe-webgpu'] : [],
      })
    }
    if (kind === 'firefox') {
      return await firefox.launch({ headless: true })
    }
    return await webkit.launch({ headless: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)
    console.log(`browser ${kind} unavailable: ${msg}`)
    return null
  }
}

async function runPage(
  browser: Browser,
  qs: URLSearchParams,
  timeoutMs = 900_000,
) {
  const page = await browser.newPage()
  const logs: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') logs.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (err) => logs.push(err.message))
  await page.goto(`http://127.0.0.1:${PORT}/${HARNESS}?${qs}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  })
  const handle = await page.waitForFunction('window.__READY__', null, {
    timeout: timeoutMs,
  })
  const report = (await handle.jsonValue()) as Record<string, unknown>
  await page.close()
  return { report, logs: logs.slice(-40) }
}

async function main() {
  await prepareDist()
  const server = await serve()
  const fixturePaths = HARD_CASES.map((c) => `/${c.rel}`)
  const combined: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    experimental: true,
    productionPathUnchanged: true,
    method: BIREFNET_METHOD,
    modelUrl: REWRITE_URL,
    hardCases: HARD_CASES,
  }

  // 1) Browser / WebGPU availability matrix
  const matrix: Record<string, unknown>[] = []
  for (const kind of ['chrome', 'edge', 'firefox', 'webkit'] as const) {
    const browser = await launchBrowser(kind, kind === 'chrome' || kind === 'edge')
    if (!browser) {
      matrix.push({
        browser: kind,
        available: false,
        reason: 'playwright channel/engine not installed or launch failed',
        webgpuSupported: false,
      })
      continue
    }
    try {
      const qs = new URLSearchParams({ mode: 'probe', model: REWRITE_URL })
      const { report, logs } = await runPage(browser, qs, 60_000)
      matrix.push({
        browser: kind,
        available: true,
        webgpuSupported: Boolean(report.hasGpu),
        report,
        logs: logs.slice(0, 5),
      })
    } catch (e) {
      matrix.push({
        browser: kind,
        available: true,
        webgpuSupported: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
    await browser.close()
  }
  combined.browserMatrix = matrix

  const persist = () => {
    writeFileSync(
      join(outDir, 'browser-readiness.json'),
      JSON.stringify(combined, null, 2),
    )
  }
  persist()

  // Fresh Chrome per phase — avoids sticky GPU/session state across long runs
  const withChrome = async (
    label: string,
    fn: (browser: Browser) => Promise<void>,
  ) => {
    const browser = await launchBrowser('chrome', true)
    if (!browser) throw new Error(`Chrome required for ${label}`)
    try {
      await fn(browser)
    } finally {
      await browser.close()
    }
  }

  // 2) Hard-case quality (Chrome WebGPU)
  await withChrome('quality', async (chrome) => {
    const qs = new URLSearchParams({
      mode: 'quality',
      model: REWRITE_URL,
      fixtures: fixturePaths.join(','),
      method: BIREFNET_METHOD,
    })
    console.log('Running hard-case quality…')
    const { report, logs } = await runPage(chrome, qs, 1_200_000)
    combined.hardCaseQuality = { report, logs }
    console.log(
      'quality ok=',
      report.ok,
      'minIou=',
      report.minIou,
      'maxFR=',
      report.maxFalseRemoval,
      'error=',
      report.error,
    )
    persist()
  })

  // 3) Lifecycle / repeated inference (single fixture ×8 + small batch)
  await withChrome('lifecycle', async (chrome) => {
    const qs = new URLSearchParams({
      mode: 'lifecycle',
      model: REWRITE_URL,
      fixtures: [
        fixturePaths.find((p) => p.includes('01_hoodie')) || fixturePaths[0]!,
        ...fixturePaths.slice(0, 4),
      ].join(','),
      repeats: '8',
    })
    console.log('Running lifecycle×8…')
    const { report, logs } = await runPage(chrome, qs, 600_000)
    combined.lifecycle = { report, logs }
    console.log(
      'lifecycle ok=',
      report.ok,
      'warmMedian=',
      report.warmMedianMs,
      'heapGrowth=',
      report.heapGrowthMb,
      'error=',
      report.error,
    )
    persist()
  })

  // 4) WebGPU unavailable → WASM still valid
  await withChrome('unavailable', async (chrome) => {
    const qs = new URLSearchParams({
      mode: 'unavailable',
      model: REWRITE_URL,
      fixtures: fixturePaths[0]!,
      forceNoGpu: '1',
    })
    console.log('Running WebGPU-unavailable fallback…')
    const { report, logs } = await runPage(chrome, qs, 300_000)
    combined.webgpuUnavailable = { report, logs }
    console.log('unavailable ok=', report.ok)
    persist()
  })

  server.close()
  persist()
  console.log('Wrote', join(outDir, 'browser-readiness.json'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
