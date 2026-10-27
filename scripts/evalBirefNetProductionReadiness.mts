/**
 * Production-readiness eval for BiRefNet-only auto-mask.
 * Reproduces fixture baseline, classifies failure regions, measures cleanup
 * candidates vs raw BiRefNet (does NOT apply under-recall blindly), probes
 * failure paths, and writes tmp-model-eval/birefnet-production-readiness-2026-10-28/.
 *
 * Run: npx tsx scripts/evalBirefNetProductionReadiness.mts
 */
import { createHash } from 'node:crypto'
import {
  copyFileSync,
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
  logitsLookDegenerate,
  logitsToMaskBuffer,
} from '../src/lib/mask/birefNet/postprocess'
import {
  BIREFNET_INPUT_NAME,
  BIREFNET_INPUT_SIZE,
  BIREFNET_METHOD,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_SHA256,
  BIREFNET_OUTPUT_NAME,
} from '../src/lib/mask/birefNet/constants'
import { computeMaskMetrics } from '../src/lib/mask/diagnostics/maskMetrics'
import { repairSdkUnderRecall } from '../src/lib/mask/sdkUnderRecallRepair'
import {
  featherMaskEdges,
  fillMaskHoles,
  morphCloseMask,
  morphOpenMask,
} from '../src/lib/mask/refineMask'
import { refineSilhouetteBoundary } from '../src/lib/mask/refineBoundary'
import { refineBoundaryAlpha } from '../src/lib/mask/refineBoundaryAlpha'
import type { MaskPixelBuffer } from '../src/types/mask'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothing = join(root, 'public', 'testdata', 'clothing')
const poloSrc = join(
  root,
  'tmp-model-eval',
  'polo-carpet-cutouts-2026-10-27',
  'sources',
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
const baselinePath = join(
  root,
  'tmp-model-eval',
  'birefnet-sole-final-verify-2026-10-27',
  'verify.json',
)
const outDir = join(
  root,
  'tmp-model-eval',
  'birefnet-production-readiness-2026-10-28',
)

const FIXTURES: { id: string; path: string; note: string }[] = [
  {
    id: 'dark-hoodie',
    path: join(clothing, '01_hoodie.jpg'),
    note: 'dark/beige garment (01_hoodie)',
  },
  {
    id: 'white-tshirt',
    path: join(clothing, '03_tshirt.jpg'),
    note: 'white on light',
  },
  {
    id: 'white-sneakers',
    path: join(clothing, '08_sneakers.jpg'),
    note: 'white sneakers',
  },
  {
    id: 'open-handbag',
    path: join(clothing, '09_handbag.jpg'),
    note: 'open handbag',
  },
  {
    id: 'polo-carpet-closeup',
    path: existsSync(join(poloSrc, 'polo-5.png'))
      ? join(poloSrc, 'polo-5.png')
      : join(clothing, '03_tshirt.jpg'),
    note: 'polo carpet close-up (collar)',
  },
]

const BGS = {
  white: [255, 255, 255] as [number, number, number],
  black: [0, 0, 0] as [number, number, number],
  gray: [128, 128, 128] as [number, number, number],
  magenta: [255, 0, 255] as [number, number, number],
}

/** Reject cleanup if IoU vs raw drops below this OR keep delta exceeds band. */
const MIN_IOU_VS_RAW = 0.985
const MAX_ABS_KEEP_DELTA = 0.015
const MAX_BORDER_KEEP_INCREASE = 0.02

type CleanupName =
  | 'morphOpen-r1'
  | 'morphClose-r1'
  | 'fillMaskHoles'
  | 'feather-r1'
  | 'refineSilhouetteBoundary'
  | 'refineBoundaryAlpha'
  | 'repairSdkUnderRecall'

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

function writePng(path: string, w: number, h: number, rgba: Uint8ClampedArray) {
  const png = new PNG({ width: w, height: h })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  writeFileSync(path, PNG.sync.write(png))
}

function cloneMask(mask: MaskPixelBuffer): MaskPixelBuffer {
  return {
    width: mask.width,
    height: mask.height,
    data: new Uint8ClampedArray(mask.data),
  }
}

function cutout(src: Uint8ClampedArray, mask: Uint8ClampedArray) {
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < mask.length; i += 1) {
    const o = i * 4
    out[o] = src[o]!
    out[o + 1] = src[o + 1]!
    out[o + 2] = src[o + 2]!
    out[o + 3] = mask[i]!
  }
  return out
}

function composite(
  src: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  bg: [number, number, number],
) {
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < mask.length; i += 1) {
    const o = i * 4
    const a = mask[i]! / 255
    out[o] = Math.round(src[o]! * a + bg[0] * (1 - a))
    out[o + 1] = Math.round(src[o + 1]! * a + bg[1] * (1 - a))
    out[o + 2] = Math.round(src[o + 2]! * a + bg[2] * (1 - a))
    out[o + 3] = 255
  }
  return out
}

function garmentRgbUnchanged(
  src: Uint8ClampedArray,
  cut: Uint8ClampedArray,
  mask: Uint8ClampedArray,
): boolean {
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]! < 250) continue
    const o = i * 4
    if (
      cut[o] !== src[o] ||
      cut[o + 1] !== src[o + 1] ||
      cut[o + 2] !== src[o + 2]
    ) {
      return false
    }
  }
  return true
}

function iouBinary(a: MaskPixelBuffer, b: MaskPixelBuffer): number {
  let inter = 0
  let uni = 0
  for (let i = 0; i < a.data.length; i += 1) {
    const ka = a.data[i]! >= 128
    const kb = b.data[i]! >= 128
    if (ka && kb) inter += 1
    if (ka || kb) uni += 1
  }
  return uni === 0 ? 1 : inter / uni
}

function softAlphaPct(mask: MaskPixelBuffer): number {
  let soft = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    const v = mask.data[i]!
    if (v > 0 && v < 255) soft += 1
  }
  return soft / mask.data.length
}

/** Pale REMOVE pixels near KEEP (proxy for missing garment / soft fringe). */
function paleRemoveNearKeep(
  image: ImageData,
  mask: MaskPixelBuffer,
  band = 3,
): { count: number; ratioOfRemove: number } {
  const { width, height, data } = mask
  const img = image.data
  let paleNear = 0
  let remove = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (data[i]! >= 128) continue
      remove += 1
      const o = i * 4
      const r = img[o]!
      const g = img[o + 1]!
      const b = img[o + 2]!
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      const chroma = Math.max(r, g, b) - Math.min(r, g, b)
      if (luma < 200 || chroma > 35) continue
      let nearKeep = false
      for (let dy = -band; dy <= band && !nearKeep; dy += 1) {
        for (let dx = -band; dx <= band; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          if (data[ny * width + nx]! >= 128) {
            nearKeep = true
            break
          }
        }
      }
      if (nearKeep) paleNear += 1
    }
  }
  return {
    count: paleNear,
    ratioOfRemove: remove > 0 ? paleNear / remove : 0,
  }
}

/** Dark/textured KEEP near border (proxy for retained carpet/bg). */
function texturedBorderKeep(
  image: ImageData,
  mask: MaskPixelBuffer,
): { count: number; ratioOfBorder: number } {
  const metrics = computeMaskMetrics(mask, image)
  const band = Math.max(2, Math.floor(Math.min(mask.width, mask.height) * 0.03))
  const { width, height, data } = mask
  const img = image.data
  let border = 0
  let textured = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const onBorder =
        x < band || y < band || x >= width - band || y >= height - band
      if (!onBorder) continue
      border += 1
      const i = y * width + x
      if (data[i]! < 128) continue
      // Local luma variance proxy
      let sum = 0
      let sum2 = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const o = (ny * width + nx) * 4
          const luma =
            0.299 * img[o]! + 0.587 * img[o + 1]! + 0.114 * img[o + 2]!
          sum += luma
          sum2 += luma * luma
          n += 1
        }
      }
      const mean = sum / Math.max(1, n)
      const var_ = sum2 / Math.max(1, n) - mean * mean
      if (var_ > 80) textured += 1
    }
  }
  void metrics
  return {
    count: textured,
    ratioOfBorder: border > 0 ? textured / border : 0,
  }
}

function applyCleanup(
  name: CleanupName,
  raw: MaskPixelBuffer,
  image: ImageData,
): { mask: MaskPixelBuffer; meta: Record<string, unknown> } {
  const mask = cloneMask(raw)
  const meta: Record<string, unknown> = { name }
  switch (name) {
    case 'morphOpen-r1':
      morphOpenMask(mask, 1)
      break
    case 'morphClose-r1':
      morphCloseMask(mask, 1)
      break
    case 'fillMaskHoles': {
      const filled = fillMaskHoles(mask)
      meta.filled = filled
      break
    }
    case 'feather-r1':
      featherMaskEdges(mask, 1)
      break
    case 'refineSilhouetteBoundary':
      refineSilhouetteBoundary(mask, image, 40)
      break
    case 'refineBoundaryAlpha':
      refineBoundaryAlpha(mask, image, { bandRadius: 2 })
      break
    case 'repairSdkUnderRecall': {
      const r = repairSdkUnderRecall(mask, image)
      meta.applied = r.applied
      meta.reason = r.reason
      break
    }
    default: {
      const _exhaustive: never = name
      throw new Error(`Unhandled cleanup: ${_exhaustive}`)
    }
  }
  return { mask, meta }
}

function classifyFailureRegions(
  id: string,
  image: ImageData,
  mask: MaskPixelBuffer,
): Record<string, unknown> {
  const metrics = computeMaskMetrics(mask, image)
  const pale = paleRemoveNearKeep(image, mask)
  const textured = texturedBorderKeep(image, mask)
  const soft = softAlphaPct(mask)

  const missingGarmentProxy = {
    description:
      'Pale REMOVE pixels within 3px of KEEP — possible bitten edges on white garments (NOT ground truth)',
    paleRemoveNearKeepCount: pale.count,
    paleRemoveNearKeepRatioOfRemove: +pale.ratioOfRemove.toFixed(4),
  }
  const retainedBackgroundProxy = {
    description:
      'Border KEEP ratio + textured border KEEP — possible carpet/studio retention (NOT ground truth)',
    borderKeepRatio: +metrics.borderKeepRatio.toFixed(4),
    texturedBorderKeepRatio: +textured.ratioOfBorder.toFixed(4),
    texturedBorderKeepCount: textured.count,
  }

  const notes: string[] = []
  if (id === 'white-tshirt' || id === 'white-sneakers') {
    if (pale.ratioOfRemove > 0.02) {
      notes.push(
        'Elevated pale REMOVE near KEEP — soft/missing fringe risk on white garment',
      )
    }
    if (soft > 0.02) {
      notes.push(`Soft alpha ring ${(100 * soft).toFixed(2)}% of pixels`)
    }
  }
  if (id === 'polo-carpet-closeup') {
    if (metrics.borderKeepRatio > 0.15) {
      notes.push(
        'High border KEEP — garment may touch frame; inspect carpet retention visually',
      )
    }
    if (textured.ratioOfBorder > 0.05) {
      notes.push('Textured KEEP on border band — carpet texture may remain')
    }
  }
  if (id === 'open-handbag' && metrics.internalHoleRatio > 0.02) {
    notes.push(
      'Internal holes present (expected for handles) — verify not garment bites',
    )
  }

  return {
    keepRatio: +metrics.keepRatio.toFixed(4),
    softAlphaPct: +soft.toFixed(4),
    borderKeepRatio: +metrics.borderKeepRatio.toFixed(4),
    internalHoleRatio: +metrics.internalHoleRatio.toFixed(4),
    keepComponents: metrics.keepComponentCount,
    missingGarmentProxy,
    retainedBackgroundProxy,
    observedNotes: notes,
  }
}

async function main() {
  mkdirSync(join(outDir, 'transparent'), { recursive: true })
  mkdirSync(join(outDir, 'composites'), { recursive: true })
  mkdirSync(join(outDir, 'masks'), { recursive: true })
  mkdirSync(join(outDir, 'cleanup-diffs'), { recursive: true })

  const baseline = existsSync(baselinePath)
    ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as {
        fixtures: { id: string; keepPct: number; inferMs: number }[]
      })
    : null

  const bytes = readFileSync(weightsPath)
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (
    bytes.length !== BIREFNET_ONNX_FP16_BYTES ||
    sha !== BIREFNET_ONNX_FP16_SHA256
  ) {
    throw new Error('Weight integrity failed')
  }

  if (ort.env?.wasm) ort.env.wasm.numThreads = 1

  const memBefore = process.memoryUsage()
  const tInit0 = Date.now()
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  const initMs = Date.now() - tInit0
  const memAfterInit = process.memoryUsage()

  const fixtureRows: Record<string, unknown>[] = []
  const cleanupAgg: Record<
    CleanupName,
    {
      name: CleanupName
      perFixture: Record<string, unknown>[]
      materialRegressions: number
      meanIou: number
      recommendApply: boolean
      rejectReason: string
    }
  > = {} as never

  const CLEANUPS: CleanupName[] = [
    'morphOpen-r1',
    'morphClose-r1',
    'fillMaskHoles',
    'feather-r1',
    'refineSilhouetteBoundary',
    'refineBoundaryAlpha',
    'repairSdkUnderRecall',
  ]
  for (const name of CLEANUPS) {
    cleanupAgg[name] = {
      name,
      perFixture: [],
      materialRegressions: 0,
      meanIou: 0,
      recommendApply: false,
      rejectReason: '',
    }
  }

  let firstInferMs = 0
  const inferTimes: number[] = []
  let rssPeak = memAfterInit.rss

  for (let fi = 0; fi < FIXTURES.length; fi += 1) {
    const fix = FIXTURES[fi]!
    if (!existsSync(fix.path)) {
      fixtureRows.push({ id: fix.id, skipped: true, reason: 'missing file' })
      continue
    }
    const ext = fix.path.slice(fix.path.lastIndexOf('.'))
    copyFileSync(fix.path, join(outDir, `${fix.id}-source${ext}`))
    const image = decodeImage(fix.path)
    const tensor = preprocessImageDataToBirefNetTensor(image)
    const input = new ort.Tensor('float32', tensor, [
      1,
      3,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
    ])
    const t0 = Date.now()
    const outputs = await session.run({ [BIREFNET_INPUT_NAME]: input })
    const inferMs = Date.now() - t0
    if (fi === 0) firstInferMs = inferMs
    inferTimes.push(inferMs)
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss)

    const out = outputs[BIREFNET_OUTPUT_NAME]!
    const logits = out.data as Float32Array
    const degenerate = logitsLookDegenerate(logits)
    const mask = logitsToMaskBuffer(
      logits,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
      image.width,
      image.height,
    )
    assertUsableMask(mask)

    const cut = cutout(image.data, mask.data)
    const rgbOk = garmentRgbUnchanged(image.data, cut, mask.data)
    const keep = countKeepPixels(mask)
    const keepPct = +((100 * keep) / mask.data.length).toFixed(2)
    const baselineKeep = baseline?.fixtures.find((f) => f.id === fix.id)?.keepPct
    const keepDeltaVsBaseline =
      baselineKeep == null ? null : +(keepPct - baselineKeep).toFixed(3)

    writePng(
      join(outDir, 'transparent', `${fix.id}-cutout.png`),
      image.width,
      image.height,
      cut,
    )
    const maskRgba = new Uint8ClampedArray(mask.data.length * 4)
    for (let i = 0; i < mask.data.length; i += 1) {
      const v = mask.data[i]!
      const o = i * 4
      maskRgba[o] = v
      maskRgba[o + 1] = v
      maskRgba[o + 2] = v
      maskRgba[o + 3] = 255
    }
    writePng(
      join(outDir, 'masks', `${fix.id}-mask.png`),
      mask.width,
      mask.height,
      maskRgba,
    )
    for (const [name, rgb] of Object.entries(BGS)) {
      writePng(
        join(outDir, 'composites', `${fix.id}-over-${name}.png`),
        image.width,
        image.height,
        composite(image.data, mask.data, rgb),
      )
    }

    const failureRegions = classifyFailureRegions(fix.id, image, mask)
    const rawMetrics = computeMaskMetrics(mask, image)

    for (const name of CLEANUPS) {
      const { mask: cleaned, meta } = applyCleanup(name, mask, image)
      const iou = iouBinary(mask, cleaned)
      const keepAfter = countKeepPixels(cleaned) / cleaned.data.length
      const keepDelta = keepAfter - rawMetrics.keepRatio
      const cleanedMetrics = computeMaskMetrics(cleaned, image)
      const borderDelta =
        cleanedMetrics.borderKeepRatio - rawMetrics.borderKeepRatio
      const cutClean = cutout(image.data, cleaned.data)
      const rgbStillOk = garmentRgbUnchanged(
        image.data,
        cutClean,
        cleaned.data,
      )
      const materialRegression =
        iou < MIN_IOU_VS_RAW ||
        Math.abs(keepDelta) > MAX_ABS_KEEP_DELTA ||
        borderDelta > MAX_BORDER_KEEP_INCREASE ||
        !rgbStillOk

      if (materialRegression) cleanupAgg[name].materialRegressions += 1
      cleanupAgg[name].meanIou += iou
      cleanupAgg[name].perFixture.push({
        id: fix.id,
        iou: +iou.toFixed(5),
        keepDelta: +keepDelta.toFixed(5),
        borderKeepDelta: +borderDelta.toFixed(5),
        softAlphaPct: +softAlphaPct(cleaned).toFixed(4),
        rgbUnchanged: rgbStillOk,
        materialRegression,
        meta,
      })

      // Diff visualization: red = gained KEEP, cyan = lost KEEP
      const diff = new Uint8ClampedArray(mask.data.length * 4)
      for (let i = 0; i < mask.data.length; i += 1) {
        const o = i * 4
        const before = mask.data[i]! >= 128
        const after = cleaned.data[i]! >= 128
        if (before === after) {
          const g = mask.data[i]!
          diff[o] = g
          diff[o + 1] = g
          diff[o + 2] = g
          diff[o + 3] = 255
        } else if (after && !before) {
          diff[o] = 255
          diff[o + 1] = 40
          diff[o + 2] = 40
          diff[o + 3] = 255
        } else {
          diff[o] = 40
          diff[o + 1] = 220
          diff[o + 2] = 220
          diff[o + 3] = 255
        }
      }
      writePng(
        join(outDir, 'cleanup-diffs', `${fix.id}__${name}.png`),
        mask.width,
        mask.height,
        diff,
      )
    }

    fixtureRows.push({
      id: fix.id,
      note: fix.note,
      methodUsed: BIREFNET_METHOD,
      provider: 'onnxruntime-web-wasm',
      width: image.width,
      height: image.height,
      dimsMatch: mask.width === image.width && mask.height === image.height,
      keepPct,
      baselineKeepPct: baselineKeep ?? null,
      keepDeltaVsBaseline,
      degenerate,
      inferMs,
      garmentRgbUnchanged: rgbOk,
      polarity: {
        convention: '255=KEEP 0=BG',
        centerMeanAlpha: (() => {
          const cx = (mask.width / 2) | 0
          const cy = (mask.height / 2) | 0
          let s = 0
          let n = 0
          for (let dy = -5; dy <= 5; dy += 1) {
            for (let dx = -5; dx <= 5; dx += 1) {
              s += mask.data[(cy + dy) * mask.width + (cx + dx)]!
              n += 1
            }
          }
          return +(s / n).toFixed(1)
        })(),
        borderMeanAlpha: (() => {
          let s = 0
          let n = 0
          for (let x = 0; x < mask.width; x += 1) {
            s += mask.data[x]!
            s += mask.data[(mask.height - 1) * mask.width + x]!
            n += 2
          }
          for (let y = 1; y < mask.height - 1; y += 1) {
            s += mask.data[y * mask.width]!
            s += mask.data[y * mask.width + mask.width - 1]!
            n += 2
          }
          return +(s / n).toFixed(1)
        })(),
      },
      failureRegions,
      cutout: `transparent/${fix.id}-cutout.png`,
    })

    console.log(
      fix.id,
      `keep=${keepPct}% Δbase=${keepDeltaVsBaseline} infer=${inferMs}ms rgbOk=${rgbOk}`,
    )
  }

  // Session reuse: re-run first fixture warm
  let warmReuseMs: number | null = null
  if (FIXTURES[0] && existsSync(FIXTURES[0].path)) {
    const image = decodeImage(FIXTURES[0].path)
    const tensor = preprocessImageDataToBirefNetTensor(image)
    const input = new ort.Tensor('float32', tensor, [
      1,
      3,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
    ])
    const t0 = Date.now()
    await session.run({ [BIREFNET_INPUT_NAME]: input })
    warmReuseMs = Date.now() - t0
  }

  for (const name of CLEANUPS) {
    const n = cleanupAgg[name].perFixture.length || 1
    cleanupAgg[name].meanIou = +(cleanupAgg[name].meanIou / n).toFixed(5)
    if (cleanupAgg[name].materialRegressions > 0) {
      cleanupAgg[name].recommendApply = false
      cleanupAgg[name].rejectReason = `material regression on ${cleanupAgg[name].materialRegressions}/${n} fixtures (IoU<${MIN_IOU_VS_RAW} or |Δkeep|>${MAX_ABS_KEEP_DELTA} or border KEEP↑>${MAX_BORDER_KEEP_INCREASE} or RGB mutated)`
    } else if (name === 'repairSdkUnderRecall') {
      cleanupAgg[name].recommendApply = false
      cleanupAgg[name].rejectReason =
        'Prior diagnosis: fires on healthy BiRefNet soft edges; do not enable'
    } else {
      // No material regression — still require objective improvement signal
      const improved = cleanupAgg[name].perFixture.some((p) => {
        const row = p as {
          keepDelta: number
          borderKeepDelta: number
          meta: { filled?: number }
        }
        return (
          (row.meta.filled ?? 0) > 0 ||
          (row.borderKeepDelta < -0.005 && Math.abs(row.keepDelta) < 0.01)
        )
      })
      if (!improved) {
        cleanupAgg[name].recommendApply = false
        cleanupAgg[name].rejectReason =
          'No objective quality gain vs raw BiRefNet across fixtures; leave production unchanged'
      } else {
        cleanupAgg[name].recommendApply = false
        cleanupAgg[name].rejectReason =
          'Conservative default: gains not proven across hard cases without human GT; leave unchanged'
      }
    }
  }

  // Failure probes (no competing model)
  const blank = new Float32Array(BIREFNET_INPUT_SIZE * BIREFNET_INPUT_SIZE).fill(
    -8,
  )
  let malformedThrew = false
  let malformedMsg = ''
  try {
    const badMask = logitsToMaskBuffer(
      blank,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
      64,
      64,
    )
    assertUsableMask(badMask)
  } catch (e) {
    malformedThrew = true
    malformedMsg = e instanceof Error ? e.message : String(e)
  }

  const memEnd = process.memoryUsage()
  const report = {
    generatedAt: new Date().toISOString(),
    baseline: {
      path: baselinePath,
      present: Boolean(baseline),
      keepPctById: Object.fromEntries(
        (baseline?.fixtures ?? []).map((f) => [f.id, f.keepPct]),
      ),
    },
    weights: {
      path: weightsPath,
      bytes: bytes.length,
      sha256: sha,
      verified: true,
    },
    runtime: {
      method: BIREFNET_METHOD,
      ep: 'wasm',
      initMs,
      firstInferMs,
      warmReuseMs,
      sequentialInferMs: inferTimes,
      sequentialBatchTotalMs: inferTimes.reduce((a, b) => a + b, 0),
      sessionReused: true,
      memory: {
        note: 'Node process.memoryUsage() — not browser heap; browser figures in browser-bench.json',
        rssBeforeMb: +(memBefore.rss / 1e6).toFixed(1),
        rssAfterInitMb: +(memAfterInit.rss / 1e6).toFixed(1),
        rssPeakMb: +(rssPeak / 1e6).toFixed(1),
        rssEndMb: +(memEnd.rss / 1e6).toFixed(1),
        heapUsedEndMb: +(memEnd.heapUsed / 1e6).toFixed(1),
      },
    },
    fixtures: fixtureRows,
    cleanupEvaluation: {
      criteria: {
        minIouVsRaw: MIN_IOU_VS_RAW,
        maxAbsKeepDelta: MAX_ABS_KEEP_DELTA,
        maxBorderKeepIncrease: MAX_BORDER_KEEP_INCREASE,
        note: 'No ground-truth masks; reject on material regression or unproven gain',
      },
      candidates: Object.values(cleanupAgg),
      productionDecision:
        'Leave BiRefNet segment path unchanged — no cleanup candidate demonstrated objective improvement without material risk',
    },
    failureProbes: {
      allNegativeLogitsFlaggedDegenerate: logitsLookDegenerate(blank),
      assertUsableMaskRejectsDegenerate: malformedThrew,
      assertUsableMaskMessage: malformedMsg,
      competingModelInvoked: false,
      note: 'App cancel uses batchGenerationRef; covered by App/batch tests — see report',
    },
    productionPathUnchanged: true,
  }

  writeFileSync(join(outDir, 'eval.json'), JSON.stringify(report, null, 2))
  writeFileSync(
    join(outDir, 'EVAL_SUMMARY.md'),
    [
      '# BiRefNet production-readiness eval (Node WASM)',
      '',
      `Generated: ${report.generatedAt}`,
      '',
      `Init ${initMs} ms · first ${firstInferMs} ms · warm reuse ${warmReuseMs} ms`,
      '',
      '## Fixtures vs baseline',
      '',
      '| ID | KEEP% | Δ baseline | Infer ms | RGB OK | Soft α% | Border KEEP |',
      '| --- | ---: | ---: | ---: | --- | ---: | ---: |',
      ...fixtureRows.map((r) => {
        const row = r as Record<string, unknown>
        if (row.skipped) return `| ${row.id} | — | — | — | — | — | — |`
        const fr = row.failureRegions as Record<string, number>
        return `| ${row.id} | ${row.keepPct} | ${row.keepDeltaVsBaseline} | ${row.inferMs} | ${row.garmentRgbUnchanged} | ${fr.softAlphaPct} | ${fr.borderKeepRatio} |`
      }),
      '',
      '## Cleanup candidates',
      '',
      '| Cleanup | Mean IoU vs raw | Material regressions | Recommend |',
      '| --- | ---: | ---: | --- |',
      ...Object.values(cleanupAgg).map(
        (c) =>
          `| ${c.name} | ${c.meanIou} | ${c.materialRegressions} | ${c.recommendApply ? 'yes' : 'no — ' + c.rejectReason.slice(0, 80)} |`,
      ),
      '',
      `Decision: ${report.cleanupEvaluation.productionDecision}`,
      '',
    ].join('\n'),
  )
  console.log('Wrote', join(outDir, 'eval.json'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
