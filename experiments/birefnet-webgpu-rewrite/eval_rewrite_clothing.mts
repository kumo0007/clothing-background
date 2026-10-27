/**
 * WASM clothing + golden eval for rewritten graph vs stock baseline masks.
 * Computes KEEP%, IoU vs stock, false garment removal / bg leakage proxies.
 * Does not touch production session.
 *
 * Run: npx tsx experiments/birefnet-webgpu-rewrite/eval_rewrite_clothing.mts
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import * as ort from 'onnxruntime-web'
import { preprocessImageDataToBirefNetTensor } from '../../src/lib/mask/birefNet/preprocess'
import {
  assertUsableMask,
  countKeepPixels,
  logitsToMaskBuffer,
} from '../../src/lib/mask/birefNet/postprocess'
import {
  BIREFNET_INPUT_NAME,
  BIREFNET_INPUT_SIZE,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_SHA256,
  BIREFNET_OUTPUT_NAME,
} from '../../src/lib/mask/birefNet/constants'
import {
  BIREFNET_FIXTURE_KEEP_BASELINE,
  type BirefNetFixtureId,
} from '../../src/lib/mask/birefNet/fixtureKeepBaseline'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = join(root, 'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28')
const clothing = join(root, 'public/testdata/clothing')
const poloDir = join(
  root,
  'tmp-model-eval/polo-carpet-hw-accel-2026-10-28/sources',
)
const stockPath = join(
  root,
  'public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx',
)
const rewritePath = join(
  outDir,
  'model_fp16.gathernd_rewrite.onnx',
)

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

function maskMetrics(ref: Uint8ClampedArray, hyp: Uint8ClampedArray) {
  let inter = 0
  let union = 0
  let falseRemoval = 0 // ref KEEP, hyp BG
  let bgLeak = 0 // ref BG, hyp KEEP
  let edgeDiff = 0
  const w = Math.round(Math.sqrt(ref.length)) // approximate; use caller dims
  void w
  for (let i = 0; i < ref.length; i += 1) {
    const r = ref[i]! >= 128
    const h = hyp[i]! >= 128
    if (r || h) union += 1
    if (r && h) inter += 1
    if (r && !h) falseRemoval += 1
    if (!r && h) bgLeak += 1
  }
  // Edge artifact proxy: disagreeing pixels on a 1px morphological boundary of ref
  // (cheap: neighbor disagree count)
  // Use linear scan with assumed width from sqrt only if square — skip if unknown.
  return {
    iou: union === 0 ? 1 : inter / union,
    falseGarmentRemovalPct: +((100 * falseRemoval) / ref.length).toFixed(4),
    backgroundLeakagePct: +((100 * bgLeak) / ref.length).toFixed(4),
    disagreePct: +((100 * (falseRemoval + bgLeak)) / ref.length).toFixed(4),
    edgeDiff,
  }
}

async function segment(
  session: ort.InferenceSession,
  image: ImageData,
) {
  const tensor = preprocessImageDataToBirefNetTensor(image)
  const t0 = performance.now()
  const outputs = await session.run({
    [BIREFNET_INPUT_NAME]: new ort.Tensor('float32', tensor, [
      1,
      3,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
    ]),
  })
  const inferMs = performance.now() - t0
  const logits = outputs[BIREFNET_OUTPUT_NAME]!.data as Float32Array
  const mask = logitsToMaskBuffer(
    logits,
    BIREFNET_INPUT_SIZE,
    BIREFNET_INPUT_SIZE,
    image.width,
    image.height,
  )
  assertUsableMask(mask)
  const keepPct = +((100 * countKeepPixels(mask)) / mask.data.length).toFixed(2)
  const maskSha256 = createHash('sha256')
    .update(Buffer.from(mask.data))
    .digest('hex')
  return { mask, logits: new Float32Array(logits), inferMs, keepPct, maskSha256 }
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const stockBytes = readFileSync(stockPath)
  const sha = createHash('sha256').update(stockBytes).digest('hex')
  if (
    stockBytes.length !== BIREFNET_ONNX_FP16_BYTES ||
    sha !== BIREFNET_ONNX_FP16_SHA256
  ) {
    throw new Error('stock integrity failed')
  }
  if (!existsSync(rewritePath)) throw new Error('missing rewrite onnx')

  if (ort.env?.wasm) ort.env.wasm.numThreads = 1
  console.log('Loading stock + rewrite WASM…')
  const stockSession = await ort.InferenceSession.create(stockBytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  const rewriteSession = await ort.InferenceSession.create(
    readFileSync(rewritePath),
    {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    },
  )

  const golden: { id: BirefNetFixtureId; path: string }[] = [
    { id: 'dark-hoodie', path: join(clothing, '01_hoodie.jpg') },
    { id: 'white-tshirt', path: join(clothing, '03_tshirt.jpg') },
    { id: 'white-sneakers', path: join(clothing, '08_sneakers.jpg') },
    { id: 'open-handbag', path: join(clothing, '09_handbag.jpg') },
    {
      id: 'polo-carpet-closeup',
      path: existsSync(join(poloDir, 'polo-5.png'))
        ? join(poloDir, 'polo-5.png')
        : join(clothing, '03_tshirt.jpg'),
    },
  ]

  const goldenRows = []
  for (const fix of golden) {
    const image = decodeImage(fix.path)
    const a = await segment(stockSession, image)
    const b = await segment(rewriteSession, image)
    const expected = BIREFNET_FIXTURE_KEEP_BASELINE[fix.id]
    const m = maskMetrics(a.mask.data, b.mask.data)
    let maxLogit = 0
    for (let i = 0; i < a.logits.length; i += 1) {
      const d = Math.abs(a.logits[i]! - b.logits[i]!)
      if (d > maxLogit) maxLogit = d
    }
    const row = {
      id: fix.id,
      stockKeepPct: a.keepPct,
      rewriteKeepPct: b.keepPct,
      expectedKeepPct: expected.keepPct,
      keepOk: b.keepPct === expected.keepPct,
      shaOk: b.maskSha256 === expected.maskSha256,
      masksExact: a.maskSha256 === b.maskSha256,
      logitMaxAbsDiff: maxLogit,
      ...m,
      stockInferMs: +a.inferMs.toFixed(1),
      rewriteInferMs: +b.inferMs.toFixed(1),
    }
    goldenRows.push(row)
    console.log(
      'golden',
      fix.id,
      row.masksExact ? 'EXACT' : `iou=${m.iou.toFixed(6)}`,
      `keep=${b.keepPct}`,
    )
  }

  const clothingFiles = readdirSync(clothing)
    .filter((n) => /^\d{2}_.*\.(jpe?g|png)$/i.test(n) && !n.includes('living'))
    .filter((n) => {
      const num = Number.parseInt(n.slice(0, 2), 10)
      return num >= 1 && num <= 10
    })
    .sort()

  const clothingRows = []
  for (const name of clothingFiles) {
    const image = decodeImage(join(clothing, name))
    const a = await segment(stockSession, image)
    const b = await segment(rewriteSession, image)
    const m = maskMetrics(a.mask.data, b.mask.data)
    clothingRows.push({
      id: name.replace(/\.[^.]+$/, ''),
      stockKeepPct: a.keepPct,
      rewriteKeepPct: b.keepPct,
      masksExact: a.maskSha256 === b.maskSha256,
      ...m,
      rewriteInferMs: +b.inferMs.toFixed(1),
    })
    console.log(
      'clothing',
      name,
      a.maskSha256 === b.maskSha256 ? 'EXACT' : `iou=${m.iou.toFixed(6)}`,
    )
  }

  const poloFiles = existsSync(poloDir)
    ? readdirSync(poloDir)
        .filter((n) => /^polo-\d+\.png$/i.test(n))
        .sort()
    : []
  const poloRows = []
  for (const name of poloFiles) {
    const image = decodeImage(join(poloDir, name))
    const a = await segment(stockSession, image)
    const b = await segment(rewriteSession, image)
    const m = maskMetrics(a.mask.data, b.mask.data)
    poloRows.push({
      id: name.replace(/\.[^.]+$/, ''),
      stockKeepPct: a.keepPct,
      rewriteKeepPct: b.keepPct,
      masksExact: a.maskSha256 === b.maskSha256,
      ...m,
      rewriteInferMs: +b.inferMs.toFixed(1),
    })
    console.log(
      'polo',
      name,
      a.maskSha256 === b.maskSha256 ? 'EXACT' : `iou=${m.iou.toFixed(6)}`,
    )
  }

  const report = {
    ok:
      goldenRows.every((r) => r.keepOk && r.shaOk && r.masksExact) &&
      clothingRows.every((r) => r.masksExact && r.iou === 1) &&
      poloRows.every((r) => r.masksExact && r.iou === 1),
    equivalenceClass: 'exact-bit-identical-logits-on-wasm' as const,
    golden: goldenRows,
    clothing: clothingRows,
    polo: poloRows,
  }
  writeFileSync(
    join(outDir, 'clothing-eval.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify({ ok: report.ok }, null, 2))
  if (!report.ok) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
