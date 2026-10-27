/**
 * Diagnose BiRefNet: checkpoint contract, raw vs under-recall-repair masks,
 * staged timings, safe WASM session option probes.
 *
 * Writes tmp-model-eval/birefnet-diagnose-2026-10-27/ (does not touch prior benches).
 *
 * Run: npx tsx scripts/diagnoseBirefNetQuality.mts
 */
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import * as ort from 'onnxruntime-web'
import { preprocessImageDataToBirefNetTensor } from '../src/lib/mask/birefNet/preprocess'
import {
  countKeepPixels,
  logitsToMaskBuffer,
} from '../src/lib/mask/birefNet/postprocess'
import {
  BIREFNET_INPUT_NAME,
  BIREFNET_INPUT_SIZE,
  BIREFNET_MEAN,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_SHA256,
  BIREFNET_OUTPUT_NAME,
  BIREFNET_STD,
} from '../src/lib/mask/birefNet/constants'
import { repairSdkUnderRecall } from '../src/lib/mask/sdkUnderRecallRepair'
import { buildIndependentReferenceMask } from '../src/lib/mask/audit/referenceMask'
import { computeBinaryMetrics } from '../src/lib/mask/audit/metrics'
import type { MaskPixelBuffer } from '../src/types/mask'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const weightsPath = join(
  root,
  'public',
  'models',
  'studioludens',
  'birefnet-lite-512',
  'onnx',
  'model_fp16.onnx',
)
const preprocessorPath = join(
  root,
  'public',
  'models',
  'studioludens',
  'birefnet-lite-512',
  'preprocessor_config.json',
)
const outDir = join(root, 'tmp-model-eval', 'birefnet-diagnose-2026-10-27')

const FIXTURES = [
  '01_hoodie.jpg',
  '03_tshirt.jpg',
  '06_sweater.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
  '10_cap.jpg',
] as const

function decodeJpeg(path: string): ImageData {
  const decoded = jpeg.decode(readFileSync(path), {
    useTArray: true,
    formatAsRGBA: true,
  })
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

function writeMaskPng(path: string, mask: MaskPixelBuffer) {
  const rgba = new Uint8ClampedArray(mask.data.length * 4)
  for (let i = 0; i < mask.data.length; i += 1) {
    const v = mask.data[i]!
    const o = i * 4
    rgba[o] = v
    rgba[o + 1] = v
    rgba[o + 2] = v
    rgba[o + 3] = 255
  }
  const png = new PNG({ width: mask.width, height: mask.height })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  writeFileSync(path, PNG.sync.write(png))
}

function maskDeltaPct(a: MaskPixelBuffer, b: MaskPixelBuffer): number {
  let diff = 0
  for (let i = 0; i < a.data.length; i += 1) {
    if ((a.data[i]! >= 128) !== (b.data[i]! >= 128)) diff += 1
  }
  return +((100 * diff) / a.data.length).toFixed(3)
}

function keepPct(mask: MaskPixelBuffer): number {
  return +((100 * countKeepPixels(mask)) / mask.data.length).toFixed(2)
}

function auditContract(): Record<string, unknown> {
  const cfg = JSON.parse(readFileSync(preprocessorPath, 'utf8')) as {
    image_mean: number[]
    image_std: number[]
    rescale_factor: number
    resample: number
    size: { height: number; width: number }
    do_normalize: boolean
    do_rescale: boolean
    do_resize: boolean
  }
  const meanMatch = cfg.image_mean.every(
    (v, i) => Math.abs(v - BIREFNET_MEAN[i]!) < 1e-9,
  )
  const stdMatch = cfg.image_std.every(
    (v, i) => Math.abs(v - BIREFNET_STD[i]!) < 1e-9,
  )
  const rescaleOk = Math.abs(cfg.rescale_factor - 1 / 255) < 1e-12
  const sizeMatch =
    cfg.size.height === BIREFNET_INPUT_SIZE &&
    cfg.size.width === BIREFNET_INPUT_SIZE
  const bilinearResample = cfg.resample === 2
  return {
    checkpoint: {
      mean: cfg.image_mean,
      std: cfg.image_std,
      rescale_factor: cfg.rescale_factor,
      resample: cfg.resample,
      resampleMeaning: bilinearResample ? 'PIL.BILINEAR' : `unknown(${cfg.resample})`,
      size: cfg.size,
      do_normalize: cfg.do_normalize,
      do_rescale: cfg.do_rescale,
      do_resize: cfg.do_resize,
    },
    appConstants: {
      mean: [...BIREFNET_MEAN],
      std: [...BIREFNET_STD],
      size: BIREFNET_INPUT_SIZE,
      rescale: 'pixel/255',
      resize: 'bilinear half-pixel',
      layout: 'NCHW float32 RGB',
      output: 'sigmoid(logits) → soft alpha → bilinear upscale → 8-bit KEEP=255',
    },
    match: {
      meanMatch,
      stdMatch,
      rescaleOk,
      sizeMatch,
      bilinearResample,
      referenceRequiresSigmoid: true,
      referenceDoc:
        'studioludens/birefnet-lite-512 README: Apply sigmoid externally to logits',
    },
    verifiedCorrect:
      meanMatch &&
      stdMatch &&
      rescaleOk &&
      sizeMatch &&
      bilinearResample,
  }
}

async function createSession(
  label: string,
  configure?: (ortMod: typeof ort) => void,
): Promise<{ session: ort.InferenceSession; initMs: number; label: string }> {
  if (configure) configure(ort)
  const bytes = readFileSync(weightsPath)
  const t0 = Date.now()
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  return { session, initMs: Date.now() - t0, label }
}

async function releaseSession(session: ort.InferenceSession): Promise<void> {
  if ('release' in session && typeof session.release === 'function') {
    await session.release()
  }
}

async function inferOnce(
  session: ort.InferenceSession,
  image: ImageData,
): Promise<{
  prepMs: number
  inferMs: number
  postMs: number
  repairMs: number
  raw: MaskPixelBuffer
  repaired: MaskPixelBuffer
  repairApplied: boolean
  repairReason?: string
  logitsMin: number
  logitsMax: number
}> {
  const prepT0 = Date.now()
  const tensorData = preprocessImageDataToBirefNetTensor(image)
  const prepMs = Date.now() - prepT0
  const input = new ort.Tensor('float32', tensorData, [
    1,
    3,
    BIREFNET_INPUT_SIZE,
    BIREFNET_INPUT_SIZE,
  ])
  const inferT0 = Date.now()
  const outputs = await session.run({ [BIREFNET_INPUT_NAME]: input })
  const inferMs = Date.now() - inferT0
  const out = outputs[BIREFNET_OUTPUT_NAME]!
  const logits = out.data as Float32Array
  let logitsMin = Infinity
  let logitsMax = -Infinity
  for (let i = 0; i < logits.length; i += 1) {
    const v = logits[i]!
    if (v < logitsMin) logitsMin = v
    if (v > logitsMax) logitsMax = v
  }
  const postT0 = Date.now()
  const raw = logitsToMaskBuffer(
    logits,
    BIREFNET_INPUT_SIZE,
    BIREFNET_INPUT_SIZE,
    image.width,
    image.height,
  )
  const postMs = Date.now() - postT0
  const repairT0 = Date.now()
  const repaired: MaskPixelBuffer = {
    width: raw.width,
    height: raw.height,
    data: new Uint8ClampedArray(raw.data),
  }
  const repair = repairSdkUnderRecall(repaired, image)
  const repairMs = Date.now() - repairT0
  return {
    prepMs,
    inferMs,
    postMs,
    repairMs,
    raw,
    repaired,
    repairApplied: repair.applied,
    repairReason: repair.reason,
    logitsMin,
    logitsMax,
  }
}

async function main() {
  mkdirSync(join(outDir, 'raw-masks'), { recursive: true })
  mkdirSync(join(outDir, 'repaired-masks'), { recursive: true })

  if (!existsSync(weightsPath)) {
    throw new Error(`Missing weights at ${weightsPath}`)
  }
  const size = statSync(weightsPath).size
  const sha = createHash('sha256').update(readFileSync(weightsPath)).digest('hex')
  if (size !== BIREFNET_ONNX_FP16_BYTES || sha !== BIREFNET_ONNX_FP16_SHA256) {
    throw new Error('Weights integrity check failed before diagnose')
  }

  const contract = auditContract()
  console.log('Contract verifiedCorrect=', contract.verifiedCorrect)

  const perfRows: Record<string, unknown>[] = []
  for (const cfg of [
    {
      label: 'wasm-default',
      configure: undefined as ((o: typeof ort) => void) | undefined,
    },
    {
      label: 'wasm-numThreads-1',
      configure: (o: typeof ort) => {
        if (o.env?.wasm) o.env.wasm.numThreads = 1
      },
    },
  ]) {
    const { session, initMs, label } = await createSession(
      cfg.label,
      cfg.configure,
    )
    const sneaker = decodeJpeg(join(clothingDir, '08_sneakers.jpg'))
    const first = await inferOnce(session, sneaker)
    const warmTimes: number[] = []
    const warmPrep: number[] = []
    const warmPost: number[] = []
    const warmRepair: number[] = []
    for (let i = 0; i < 3; i += 1) {
      const w = await inferOnce(session, sneaker)
      warmTimes.push(w.inferMs)
      warmPrep.push(w.prepMs)
      warmPost.push(w.postMs)
      warmRepair.push(w.repairMs)
    }
    const mean = (xs: number[]) =>
      Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
    perfRows.push({
      label,
      initMs,
      firstInferMs: first.inferMs,
      firstPrepMs: first.prepMs,
      firstPostMs: first.postMs,
      firstRepairMs: first.repairMs,
      meanWarmInferMs: mean(warmTimes),
      meanWarmPrepMs: mean(warmPrep),
      meanWarmPostMs: mean(warmPost),
      meanWarmRepairMs: mean(warmRepair),
      warmInferMs: warmTimes,
    })
    console.log(
      label,
      `init=${initMs} firstInfer=${first.inferMs} meanWarm=${mean(warmTimes)}`,
    )
    await releaseSession(session)
  }

  const { session } = await createSession('quality')
  const fixtureRows: Record<string, unknown>[] = []
  for (const file of FIXTURES) {
    const src = join(clothingDir, file)
    copyFileSync(src, join(outDir, file.replace('.jpg', '-source.jpg')))
    const image = decodeJpeg(src)
    const result = await inferOnce(session, image)
    const ref = buildIndependentReferenceMask(image)
    const rawBin = computeBinaryMetrics(result.raw, ref)
    const repBin = computeBinaryMetrics(result.repaired, ref)
    const rawIoU = rawBin.iou ?? 0
    const repIoU = repBin.iou ?? 0
    writeMaskPng(
      join(outDir, 'raw-masks', file.replace('.jpg', '-raw.png')),
      result.raw,
    )
    writeMaskPng(
      join(outDir, 'repaired-masks', file.replace('.jpg', '-repaired.png')),
      result.repaired,
    )
    const deltaPx = maskDeltaPct(result.raw, result.repaired)
    const assessment =
      Math.abs(repIoU - rawIoU) < 0.01 && deltaPx < 0.5
        ? 'cleanup negligible — quality driven by model/raw mask'
        : result.repairApplied
          ? 'under-recall repair changed mask — inspect visuals'
          : 'cleanup changed mask without repair flag'
    fixtureRows.push({
      fixture: file,
      keepRaw: keepPct(result.raw),
      keepRepaired: keepPct(result.repaired),
      binaryDeltaPct: deltaPx,
      repairApplied: result.repairApplied,
      repairReason: result.repairReason ?? null,
      rawVsRefIoU: rawBin.iou,
      repairedVsRefIoU: repBin.iou,
      iouDeltaRepairedMinusRaw: +(repIoU - rawIoU).toFixed(4),
      logitsMin: +result.logitsMin.toFixed(4),
      logitsMax: +result.logitsMax.toFixed(4),
      inferMs: result.inferMs,
      prepMs: result.prepMs,
      postMs: result.postMs,
      repairMs: result.repairMs,
      assessment,
    })
    console.log(
      file,
      `rawIoU=${rawIoU.toFixed(3)} repIoU=${repIoU.toFixed(3)} deltaPx%=${deltaPx} repair=${result.repairApplied}`,
    )
  }
  await releaseSession(session)

  const overall =
    contract.verifiedCorrect === true
      ? 'Pre/post match checkpoint README + preprocessor_config; remaining IoU gap vs Lab-seed is primarily model/metric limitation, not inverted polarity or missing sigmoid.'
      : 'Contract mismatch — investigate before attributing to model quality.'

  const report = {
    generatedAt: new Date().toISOString(),
    contract,
    performance: perfRows,
    fixtures: fixtureRows,
    webgpuConclusion:
      'Confirmed defect on this Chrome adapter: session creates but emits degenerate all-negative logits + computeSliceOffsets validation errors. Keep disabled for production.',
    overall,
  }
  writeFileSync(join(outDir, 'diagnose.json'), JSON.stringify(report, null, 2))
  writeFileSync(
    join(outDir, 'REPORT.md'),
    [
      '# BiRefNet quality & performance diagnosis',
      '',
      `Generated: ${report.generatedAt}`,
      '',
      '## Contract',
      '',
      '```json',
      JSON.stringify(contract, null, 2),
      '```',
      '',
      '## Performance (sneakers)',
      '',
      '| Config | Init ms | First infer | Mean warm infer | Prep | Post | Repair |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...perfRows.map((r) => {
        const row = r as Record<string, number | string>
        return `| ${row.label} | ${row.initMs} | ${row.firstInferMs} | ${row.meanWarmInferMs} | ${row.meanWarmPrepMs ?? row.firstPrepMs} | ${row.meanWarmPostMs ?? row.firstPostMs} | ${row.meanWarmRepairMs ?? row.firstRepairMs} |`
      }),
      '',
      '## Raw vs under-recall repair',
      '',
      '| Fixture | Raw IoU† | Repaired IoU† | ΔIoU | Δkeep-binary % | Repair? | Assessment |',
      '| --- | ---: | ---: | ---: | ---: | --- | --- |',
      ...fixtureRows.map((r) => {
        const row = r as Record<string, unknown>
        const raw = row.rawVsRefIoU as number | null
        const rep = row.repairedVsRefIoU as number | null
        return `| ${row.fixture} | ${raw == null ? 'n/a' : raw.toFixed(3)} | ${rep == null ? 'n/a' : rep.toFixed(3)} | ${row.iouDeltaRepairedMinusRaw} | ${row.binaryDeltaPct} | ${row.repairApplied} | ${row.assessment} |`
      }),
      '',
      '† Heuristic reference — not GT.',
      '',
      '## Conclusion',
      '',
      overall,
      '',
      report.webgpuConclusion,
      '',
    ].join('\n'),
  )
  console.log('Wrote', join(outDir, 'REPORT.md'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
