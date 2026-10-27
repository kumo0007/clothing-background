/**
 * Chromium verification of BiRefNet — separate contexts for WebGPU and WASM.
 *
 * Prerequisites: `npm run fetch:birefnet-weights` + `npm run build`
 * Run: npx tsx scripts/verifyBirefNetBrowser.mts
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
import { chromium, type Browser } from 'playwright-core'
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
const fixtureSrc = join(
  root,
  'public',
  'testdata',
  'clothing',
  '08_sneakers.jpg',
)
const harnessSrc = join(root, 'scripts', 'birefnet-browser-harness.html')
const outDir = join(root, 'tmp-model-eval', 'birefnet-browser-verify')

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
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', resolve),
  )
  return server
}

async function runEp(
  browser: Browser,
  port: number,
  ep: 'wasm' | 'webgpu',
): Promise<{ report: Record<string, unknown>; logs: string[] }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const logs: string[] = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

  const qs = new URLSearchParams({
    ort: `/ort-vendor/ort.min.mjs`,
    wasmPaths: `/ort-vendor/`,
    model: `/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx`,
    fixture: `/testdata/clothing/08_sneakers.jpg`,
    method: BIREFNET_METHOD,
    ep,
  })
  await page.goto(
    `http://127.0.0.1:${port}/birefnet-browser-harness.html?${qs}`,
    { waitUntil: 'domcontentloaded', timeout: 120_000 },
  )
  const handle = await page.waitForFunction('window.__BIREFNET_VERIFY__', null, {
    timeout: 600_000,
  })
  const report = (await handle.jsonValue()) as Record<string, unknown>
  await context.close()
  return { report, logs }
}

async function main() {
  if (!existsSync(weightPath)) throw new Error(`Weights missing: ${weightPath}`)
  if (statSync(weightPath).size !== BIREFNET_ONNX_FP16_BYTES) {
    throw new Error('Incomplete BiRefNet weights')
  }
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error('dist/ missing — run npm run build first')
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

  const fixtureDistDir = join(distDir, 'testdata', 'clothing')
  mkdirSync(fixtureDistDir, { recursive: true })
  copyFileSync(fixtureSrc, join(fixtureDistDir, '08_sneakers.jpg'))
  copyFileSync(harnessSrc, join(distDir, 'birefnet-browser-harness.html'))

  const ortVendor = join(distDir, 'ort-vendor')
  mkdirSync(ortVendor, { recursive: true })
  const ortPkg = join(root, 'node_modules', 'onnxruntime-web', 'dist')
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

  mkdirSync(outDir, { recursive: true })
  const port = 5179
  const server = await serveStatic(distDir, port)
  const browser = await chromium
    .launch({
      headless: true,
      channel: 'chrome',
      args: ['--enable-unsafe-webgpu'],
    })
    .catch(() =>
      chromium.launch({
        headless: true,
        args: ['--enable-unsafe-webgpu'],
      }),
    )

  // WebGPU first in its own context (may report degenerate quality).
  const webgpu = await runEp(browser, port, 'webgpu')
  // Fresh context for WASM (authoritative usable path on this host).
  const wasm = await runEp(browser, port, 'wasm')

  const combined = {
    generatedAt: new Date().toISOString(),
    webgpu: webgpu.report,
    wasm: wasm.report,
    webgpuLogs: webgpu.logs.slice(-40),
    wasmLogs: wasm.logs.slice(-40),
  }
  writeFileSync(join(outDir, 'browser-verify.json'), JSON.stringify(combined, null, 2))
  writeFileSync(
    join(outDir, 'REPORT.md'),
    [
      '# BiRefNet browser verification (WebGPU + WASM)',
      '',
      '## WebGPU',
      '',
      '```json',
      JSON.stringify(webgpu.report, null, 2),
      '```',
      '',
      '## WASM',
      '',
      '```json',
      JSON.stringify(wasm.report, null, 2),
      '```',
      '',
    ].join('\n'),
  )
  console.log(JSON.stringify(combined, null, 2))

  await browser.close()
  server.close()

  const wr = webgpu.report
  const ar = wasm.report
  if (!ar.ok) throw new Error(`WASM failed: ${ar.error}`)
  if (!ar.notSilentRmbg) throw new Error('WASM method id is not BiRefNet')
  if ((ar.nonFinite as number) > 0) throw new Error('WASM non-finite logits')
  if (!ar.meaningfulKeep) {
    throw new Error(`WASM KEEP too low (${ar.keepRatio})`)
  }

  // WebGPU may create but produce unusable masks — record, do not fail the gate
  // unless session create itself crashed without a report.
  if (wr.ok === false) {
    console.warn('WebGPU harness error:', wr.error)
  } else if (!wr.meaningfulKeep || wr.degenerate) {
    console.warn(
      `WebGPU ran but quality failed (keep=${wr.keepRatio} degenerate=${wr.degenerate} raw=[${wr.rawMin},${wr.rawMax}])`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
