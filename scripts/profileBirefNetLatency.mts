/**
 * Stage-level BiRefNet WASM latency profile (cold / warm / 5-image batch).
 * Does not change production code. Writes:
 *   tmp-model-eval/birefnet-latency-profile-2026-10-28/
 *
 * Run: npx tsx scripts/profileBirefNetLatency.mts
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import * as ort from 'onnxruntime-web'
import { preprocessImageDataToBirefNetTensor } from '../src/lib/mask/birefNet/preprocess'
import {
  assertUsableMask,
  countKeepPixels,
  logitsToMaskBuffer,
} from '../src/lib/mask/birefNet/postprocess'
import {
  BIREFNET_INPUT_NAME,
  BIREFNET_INPUT_SIZE,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_SHA256,
  BIREFNET_ONNX_FP16_PATH,
  BIREFNET_OUTPUT_NAME,
} from '../src/lib/mask/birefNet/constants'
import { reviewSdkMask } from '../src/lib/mask/sdkMaskReview'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothing = join(root, 'public', 'testdata', 'clothing')
const poloSrc = join(
  root,
  'tmp-model-eval',
  'polo-carpet-cutouts-2026-10-27',
  'sources',
  'polo-5.png',
)
const weightsPath = join(
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
  'birefnet-latency-profile-2026-10-28',
)

const FIXTURES = [
  { id: 'dark-hoodie', path: join(clothing, '01_hoodie.jpg') },
  { id: 'white-tshirt', path: join(clothing, '03_tshirt.jpg') },
  { id: 'white-sneakers', path: join(clothing, '08_sneakers.jpg') },
  { id: 'open-handbag', path: join(clothing, '09_handbag.jpg') },
  {
    id: 'polo-carpet-closeup',
    path: existsSync(poloSrc) ? poloSrc : join(clothing, '03_tshirt.jpg'),
  },
]

const BASELINE_KEEP: Record<string, number> = {
  'dark-hoodie': 55.43,
  'white-tshirt': 49.04,
  'white-sneakers': 34.5,
  'open-handbag': 35.68,
  'polo-carpet-closeup': 73.89,
}

function now() {
  return performance.now()
}

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

function maskSha(mask: { data: Uint8ClampedArray }): string {
  return createHash('sha256').update(Buffer.from(mask.data)).digest('hex')
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const bytes = readFileSync(weightsPath)
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (
    bytes.length !== BIREFNET_ONNX_FP16_BYTES ||
    sha !== BIREFNET_ONNX_FP16_SHA256
  ) {
    throw new Error('weight integrity failed')
  }

  if (ort.env?.wasm) ort.env.wasm.numThreads = 1

  // --- Cold init breakdown ---
  const cold: Record<string, number> = {}
  let t = now()
  // Simulate probe: HEAD equivalent = stat (browser does network)
  const probeOk =
    existsSync(weightsPath) &&
    readFileSync(weightsPath).length === BIREFNET_ONNX_FP16_BYTES
  cold.probeMs = +(now() - t).toFixed(1)
  if (!probeOk) throw new Error('probe failed')

  t = now()
  // ort already imported; measure fresh session create from buffer vs path
  const sessionFromBuffer = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  cold.sessionCreateFromBufferMs = +(now() - t).toFixed(1)

  // Release and create from file path (closer to browser URL create after fetch)
  if ('release' in sessionFromBuffer) {
    await (sessionFromBuffer as { release?: () => Promise<void> }).release?.()
  }

  t = now()
  const sessionFromPath = await ort.InferenceSession.create(weightsPath, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  cold.sessionCreateFromPathMs = +(now() - t).toFixed(1)

  const session = sessionFromPath

  // --- Warm single-image stage breakdown (sneakers) ---
  const warmImage = decodeImage(FIXTURES[2]!.path)
  const warmStages: Record<string, number> = {}

  t = now()
  const tensor = preprocessImageDataToBirefNetTensor(warmImage)
  warmStages.preprocessMs = +(now() - t).toFixed(1)

  const input = new ort.Tensor('float32', tensor, [
    1,
    3,
    BIREFNET_INPUT_SIZE,
    BIREFNET_INPUT_SIZE,
  ])

  // Discard first run after create (still warming ORT)
  t = now()
  await session.run({ [BIREFNET_INPUT_NAME]: input })
  warmStages.firstRunAfterCreateMs = +(now() - t).toFixed(1)

  t = now()
  const out2 = await session.run({
    [BIREFNET_INPUT_NAME]: new ort.Tensor('float32', tensor, [
      1,
      3,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
    ]),
  })
  warmStages.sessionRunMs = +(now() - t).toFixed(1)

  const logits = out2[BIREFNET_OUTPUT_NAME]!.data as Float32Array

  t = now()
  const mask = logitsToMaskBuffer(
    logits,
    BIREFNET_INPUT_SIZE,
    BIREFNET_INPUT_SIZE,
    warmImage.width,
    warmImage.height,
  )
  assertUsableMask(mask)
  warmStages.postprocessMs = +(now() - t).toFixed(1)

  t = now()
  reviewSdkMask(mask, warmImage, { resized: true, method: 'birefnet-lite-512' })
  warmStages.reviewMs = +(now() - t).toFixed(1)

  t = now()
  decodeImage(FIXTURES[2]!.path)
  warmStages.decodeJpegMs = +(now() - t).toFixed(1)

  // Redundant decode simulation (autoMaskCorners loadHtmlImage+decode)
  t = now()
  decodeImage(FIXTURES[2]!.path)
  decodeImage(FIXTURES[2]!.path)
  warmStages.doubleDecodeMs = +(now() - t).toFixed(1)

  // --- 5-image batch on shared session ---
  const batch: {
    id: string
    decodeMs: number
    preprocessMs: number
    sessionRunMs: number
    postprocessMs: number
    reviewMs: number
    totalMs: number
    keepPct: number
    maskSha256: string
    keepDeltaVsBaseline: number
  }[] = []

  for (const fix of FIXTURES) {
    const tAll = now()
    t = now()
    const image = decodeImage(fix.path)
    const decodeMs = now() - t

    t = now()
    const ten = preprocessImageDataToBirefNetTensor(image)
    const preprocessMs = now() - t

    t = now()
    const outputs = await session.run({
      [BIREFNET_INPUT_NAME]: new ort.Tensor('float32', ten, [
        1,
        3,
        BIREFNET_INPUT_SIZE,
        BIREFNET_INPUT_SIZE,
      ]),
    })
    const sessionRunMs = now() - t

    t = now()
    const m = logitsToMaskBuffer(
      outputs[BIREFNET_OUTPUT_NAME]!.data as Float32Array,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
      image.width,
      image.height,
    )
    assertUsableMask(m)
    const postprocessMs = now() - t

    t = now()
    reviewSdkMask(m, image, { resized: true, method: 'birefnet-lite-512' })
    const reviewMs = now() - t

    const keep = countKeepPixels(m)
    const keepPct = +((100 * keep) / m.data.length).toFixed(2)
    batch.push({
      id: fix.id,
      decodeMs: +decodeMs.toFixed(1),
      preprocessMs: +preprocessMs.toFixed(1),
      sessionRunMs: +sessionRunMs.toFixed(1),
      postprocessMs: +postprocessMs.toFixed(1),
      reviewMs: +reviewMs.toFixed(1),
      totalMs: +(now() - tAll).toFixed(1),
      keepPct,
      maskSha256: maskSha(m),
      keepDeltaVsBaseline: +(keepPct - (BASELINE_KEEP[fix.id] ?? keepPct)).toFixed(
        3,
      ),
    })
  }

  // Concurrency probe: two parallel session.run on SAME session (expect unsafe / no gain)
  const imgA = decodeImage(FIXTURES[0]!.path)
  const imgB = decodeImage(FIXTURES[1]!.path)
  const tenA = preprocessImageDataToBirefNetTensor(imgA)
  const tenB = preprocessImageDataToBirefNetTensor(imgB)
  const feed = (ten: Float32Array) => ({
    [BIREFNET_INPUT_NAME]: new ort.Tensor('float32', ten, [
      1,
      3,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
    ]),
  })
  t = now()
  await session.run(feed(tenA))
  await session.run(feed(tenB))
  const sequentialTwoMs = +(now() - t).toFixed(1)

  t = now()
  let parallelError: string | null = null
  try {
    await Promise.all([session.run(feed(tenA)), session.run(feed(tenB))])
  } catch (e) {
    parallelError = e instanceof Error ? e.message : String(e)
  }
  const parallelTwoMs = +(now() - t).toFixed(1)

  const sums = batch.reduce(
    (acc, row) => {
      acc.decode += row.decodeMs
      acc.preprocess += row.preprocessMs
      acc.run += row.sessionRunMs
      acc.post += row.postprocessMs
      acc.review += row.reviewMs
      acc.total += row.totalMs
      return acc
    },
    { decode: 0, preprocess: 0, run: 0, post: 0, review: 0, total: 0 },
  )

  const report = {
    generatedAt: new Date().toISOString(),
    note: 'Node onnxruntime-web WASM — browser absolute ms differ; stage share is the signal',
    publicModelPath: BIREFNET_ONNX_FP16_PATH,
    cold,
    warmSingle: warmStages,
    batch,
    batchStageSharePct: {
      decode: +((100 * sums.decode) / sums.total).toFixed(1),
      preprocess: +((100 * sums.preprocess) / sums.total).toFixed(1),
      sessionRun: +((100 * sums.run) / sums.total).toFixed(1),
      postprocess: +((100 * sums.post) / sums.total).toFixed(1),
      review: +((100 * sums.review) / sums.total).toFixed(1),
    },
    batchTotalMs: +sums.total.toFixed(1),
    concurrencyProbe: {
      sequentialTwoMs,
      parallelTwoMs,
      parallelError,
      conclusion:
        parallelError
          ? 'Parallel session.run on one session failed — keep concurrency 1'
          : parallelTwoMs >= sequentialTwoMs * 0.85
            ? 'Parallel offered little/no speedup — keep concurrency 1 (avoid dual memory)'
            : 'Unexpected parallel speedup — investigate carefully before enabling',
    },
    memory: {
      rssMb: +(process.memoryUsage().rss / 1e6).toFixed(1),
      heapUsedMb: +(process.memoryUsage().heapUsed / 1e6).toFixed(1),
    },
  }

  writeFileSync(join(outDir, 'profile.json'), JSON.stringify(report, null, 2))
  writeFileSync(
    join(outDir, 'REPORT.md'),
    [
      '# BiRefNet latency profile',
      '',
      `Generated: ${report.generatedAt}`,
      '',
      '## Cold',
      '',
      '```json',
      JSON.stringify(cold, null, 2),
      '```',
      '',
      '## Warm single (sneakers)',
      '',
      '```json',
      JSON.stringify(warmStages, null, 2),
      '```',
      '',
      '## Batch stage share',
      '',
      '```json',
      JSON.stringify(report.batchStageSharePct, null, 2),
      '```',
      '',
      `Batch total: ${report.batchTotalMs} ms`,
      '',
      '## Concurrency',
      '',
      '```json',
      JSON.stringify(report.concurrencyProbe, null, 2),
      '```',
      '',
    ].join('\n'),
  )
  console.log(JSON.stringify(report, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
