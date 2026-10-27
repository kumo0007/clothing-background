/**
 * Compare stock vs GatherND-rewritten BiRefNet via onnxruntime-web WASM.
 * Isolated experiment — does not touch production session.ts.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ort from 'onnxruntime-web'
import {
  BIREFNET_INPUT_NAME,
  BIREFNET_INPUT_SIZE,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_SHA256,
  BIREFNET_OUTPUT_NAME,
} from '../../src/lib/mask/birefNet/constants'
import { preprocessImageDataToBirefNetTensor } from '../../src/lib/mask/birefNet/preprocess'
import {
  assertUsableMask,
  countKeepPixels,
  logitsToMaskBuffer,
} from '../../src/lib/mask/birefNet/postprocess'
import { BIREFNET_FIXTURE_KEEP_BASELINE } from '../../src/lib/mask/birefNet/fixtureKeepBaseline'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const stockPath = join(
  root,
  'public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx',
)
const rewrittenPath = join(
  root,
  'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/model_fp16.gathernd_rewrite.onnx',
)
const outDir = join(root, 'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28')
const clothing = join(root, 'public/testdata/clothing')

function decodeImage(path: string): ImageData {
  const buf = readFileSync(path)
  if (path.toLowerCase().endsWith('.png')) {
    const png = PNG.sync.read(buf)
    return {
      width: png.width,
      height: png.height,
      data: new Uint8ClampedArray(
        png.data.buffer,
        png.data.byteOffset,
        png.data.byteLength,
      ),
      colorSpace: 'srgb',
    } as ImageData
  }
  const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength,
    ),
    colorSpace: 'srgb',
  } as ImageData
}

function stats(a: Float32Array, b: Float32Array) {
  let max = 0
  let sum = 0
  let n = a.length
  for (let i = 0; i < n; i += 1) {
    const d = Math.abs(a[i]! - b[i]!)
    if (d > max) max = d
    sum += d
  }
  return { maxAbsDiff: max, meanAbsDiff: sum / n, exactEqual: max === 0 }
}

async function createSession(bytes: Buffer) {
  if (ort.env?.wasm) ort.env.wasm.numThreads = 1
  return ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
}

async function infer(
  session: ort.InferenceSession,
  image: ImageData,
): Promise<{ logits: Float32Array; keepPct: number; maskSha: string }> {
  const tensor = preprocessImageDataToBirefNetTensor(image)
  const outputs = await session.run({
    [BIREFNET_INPUT_NAME]: new ort.Tensor('float32', tensor, [
      1,
      3,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
    ]),
  })
  const out = outputs[BIREFNET_OUTPUT_NAME]!
  const logits = out.data as Float32Array
  const mask = logitsToMaskBuffer(
    logits,
    BIREFNET_INPUT_SIZE,
    BIREFNET_INPUT_SIZE,
    image.width,
    image.height,
  )
  assertUsableMask(mask)
  const keepPct = +((100 * countKeepPixels(mask)) / mask.data.length).toFixed(2)
  const maskSha = createHash('sha256')
    .update(Buffer.from(mask.data))
    .digest('hex')
  return { logits: new Float32Array(logits), keepPct, maskSha }
}

async function main() {
  const stockBytes = readFileSync(stockPath)
  const sha = createHash('sha256').update(stockBytes).digest('hex')
  if (
    stockBytes.length !== BIREFNET_ONNX_FP16_BYTES ||
    sha !== BIREFNET_ONNX_FP16_SHA256
  ) {
    throw new Error('stock integrity failed')
  }
  if (!existsSync(rewrittenPath)) {
    throw new Error(`missing rewritten model at ${rewrittenPath}`)
  }
  const rewrittenBytes = readFileSync(rewrittenPath)

  console.log('Loading stock WASM…')
  const stockSession = await createSession(stockBytes)
  console.log('Loading rewritten WASM…')
  let rewrittenSession: ort.InferenceSession
  try {
    rewrittenSession = await createSession(rewrittenBytes)
  } catch (e) {
    const report = {
      ok: false,
      blocker: 'rewritten-session-create-failed',
      error: e instanceof Error ? e.message : String(e),
    }
    writeFileSync(
      join(outDir, 'wasm-equivalence.json'),
      JSON.stringify(report, null, 2),
    )
    console.log(JSON.stringify(report, null, 2))
    process.exit(1)
  }

  const fixtures: { id: string; path: string }[] = [
    { id: 'dark-hoodie', path: join(clothing, '01_hoodie.jpg') },
    { id: 'white-tshirt', path: join(clothing, '03_tshirt.jpg') },
    { id: 'white-sneakers', path: join(clothing, '08_sneakers.jpg') },
    { id: 'open-handbag', path: join(clothing, '09_handbag.jpg') },
  ]
  const polo = join(
    root,
    'tmp-model-eval/polo-carpet-hw-accel-2026-10-28/sources/polo-5.png',
  )
  fixtures.push({
    id: 'polo-carpet-closeup',
    path: existsSync(polo) ? polo : join(clothing, '03_tshirt.jpg'),
  })

  const rows = []
  for (const fix of fixtures) {
    const image = decodeImage(fix.path)
    const a = await infer(stockSession, image)
    const b = await infer(rewrittenSession, image)
    const s = stats(a.logits, b.logits)
    const baseline =
      BIREFNET_FIXTURE_KEEP_BASELINE[
        fix.id as keyof typeof BIREFNET_FIXTURE_KEEP_BASELINE
      ]
    rows.push({
      id: fix.id,
      stockKeepPct: a.keepPct,
      rewrittenKeepPct: b.keepPct,
      stockMaskSha: a.maskSha,
      rewrittenMaskSha: b.maskSha,
      stockMatchesGolden:
        baseline &&
        a.keepPct === baseline.keepPct &&
        a.maskSha === baseline.maskSha256,
      masksIdentical: a.maskSha === b.maskSha,
      ...s,
    })
    console.log(
      fix.id,
      `logitMaxDiff=${s.maxAbsDiff.toExponential(3)}`,
      `maskEq=${a.maskSha === b.maskSha}`,
      `keep ${a.keepPct}->${b.keepPct}`,
    )
  }

  const report = {
    ok: rows.every((r) => r.masksIdentical && r.stockMatchesGolden),
    stockSha256: sha,
    rewrittenSha256: createHash('sha256').update(rewrittenBytes).digest('hex'),
    fixtures: rows,
  }
  writeFileSync(
    join(outDir, 'wasm-equivalence.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify({ ok: report.ok }, null, 2))
  if (!report.ok) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
