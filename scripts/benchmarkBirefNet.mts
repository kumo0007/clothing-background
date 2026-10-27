/**
 * Clothing-fixture benchmark: BiRefNet_lite 512 (ONNX WASM) vs Lab-seed,
 * with optional RMBG-1.4 when the same-origin q8 mirror is present.
 *
 * Does not change production defaults. Writes
 * tmp-model-eval/birefnet-bench/ (masks, composites, summary.json, REPORT.md).
 *
 * Run: npx tsx scripts/benchmarkBirefNet.mts
 */
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
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
import {
  buildIndependentReferenceMask,
  summarizeReferenceCoverage,
} from '../src/lib/mask/audit/referenceMask'
import {
  computeBinaryMetrics,
  computeBoundaryMetrics,
  computeInternalHoleError,
} from '../src/lib/mask/audit/metrics'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import { preprocessImageDataToBirefNetTensor } from '../src/lib/mask/birefNet/preprocess'
import { logitsToMaskBuffer, countKeepPixels } from '../src/lib/mask/birefNet/postprocess'
import {
  BIREFNET_INPUT_NAME,
  BIREFNET_INPUT_SIZE,
  BIREFNET_METHOD,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_SHA256,
  BIREFNET_OUTPUT_NAME,
} from '../src/lib/mask/birefNet/constants'
import { createHash } from 'node:crypto'
import type { MaskPixelBuffer } from '../src/types/mask'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
/** Override with BIREFNET_BENCH_OUT to avoid overwriting a prior baseline. */
const outDir = join(
  root,
  'tmp-model-eval',
  process.env.BIREFNET_BENCH_OUT?.trim() || 'birefnet-bench',
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
const rmbgPath = join(
  root,
  'public',
  'models',
  'briaai',
  'RMBG-1.4',
  'onnx',
  'model_quantized.onnx',
)

const FIXTURES = [
  '01_hoodie.jpg',
  '02_blazer.jpg',
  '03_tshirt.jpg',
  '04_jeans.jpg',
  '05_coat.jpg',
  '06_sweater.jpg',
  '07_dress.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
  '10_cap.jpg',
] as const

const BEIGE: [number, number, number] = [217, 196, 174]
const MAGENTA: [number, number, number] = [255, 0, 255]

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

function writePng(
  path: string,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
) {
  const png = new PNG({ width, height })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  writeFileSync(path, PNG.sync.write(png))
}

function maskToRgba(mask: MaskPixelBuffer): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(mask.data.length * 4)
  for (let i = 0; i < mask.data.length; i += 1) {
    const v = mask.data[i]!
    const o = i * 4
    rgba[o] = v
    rgba[o + 1] = v
    rgba[o + 2] = v
    rgba[o + 3] = 255
  }
  return rgba
}

function transparentComposite(
  src: Uint8ClampedArray,
  mask: Uint8ClampedArray,
): Uint8ClampedArray {
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

function fillBg(n: number, rgb: [number, number, number]) {
  const b = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i += 1) {
    const o = i * 4
    b[o] = rgb[0]
    b[o + 1] = rgb[1]
    b[o + 2] = rgb[2]
    b[o + 3] = 255
  }
  return b
}

function softPct(mask: MaskPixelBuffer): number {
  let soft = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    const v = mask.data[i]!
    if (v > 0 && v < 255) soft += 1
  }
  return +((100 * soft) / mask.data.length).toFixed(2)
}

function keepPct(mask: MaskPixelBuffer): number {
  return +((100 * countKeepPixels(mask)) / mask.data.length).toFixed(2)
}

function finiteOk(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i += 1) {
    if (!Number.isFinite(arr[i]!)) return false
  }
  return true
}

function qualitativeFlags(file: string, mask: MaskPixelBuffer, holes: number): string[] {
  const flags: string[] = []
  const cov = keepPct(mask)
  if (file.includes('sneakers') || file.includes('tshirt')) {
    if (cov < 5) flags.push('likely under-seg (white-on-light)')
    if (cov > 85) flags.push('likely over-seg / bg retained')
  }
  if (file.includes('handbag') && holes === 0) {
    flags.push('handle hole may be filled (inspect visually)')
  }
  if (softPct(mask) > 25) flags.push('heavy soft fringe / halo risk')
  return flags
}

async function runBiref(
  session: ort.InferenceSession,
  image: ImageData,
  inputName: string,
  outputName: string,
): Promise<{ mask: MaskPixelBuffer; inferMs: number; logitsLen: number }> {
  const tensorData = preprocessImageDataToBirefNetTensor(image)
  const input = new ort.Tensor('float32', tensorData, [
    1,
    3,
    BIREFNET_INPUT_SIZE,
    BIREFNET_INPUT_SIZE,
  ])
  const t0 = Date.now()
  const outputs = await session.run({ [inputName]: input })
  const inferMs = Date.now() - t0
  const out = outputs[outputName]!
  const logits = out.data as Float32Array
  if (!finiteOk(logits)) {
    throw new Error('BiRefNet produced non-finite logits')
  }
  const dims = out.dims.map((d) => Number(d))
  const mh = dims.length >= 2 ? dims[dims.length - 2]! : BIREFNET_INPUT_SIZE
  const mw = dims.length >= 2 ? dims[dims.length - 1]! : BIREFNET_INPUT_SIZE
  const mask = logitsToMaskBuffer(logits, mw, mh, image.width, image.height)
  return { mask, inferMs, logitsLen: logits.length }
}

/** Best-effort RMBG-1.4 q8 ONNX (Transformers.js layout differs — probe inputs). */
async function tryRmbgMask(
  session: ort.InferenceSession | null,
  image: ImageData,
): Promise<{ mask: MaskPixelBuffer; inferMs: number } | null> {
  if (!session) return null
  try {
    const size = 1024
    const data = new Float32Array(1 * 3 * size * size)
    const { width: w, height: h, data: src } = image
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const sx = Math.min(w - 1, Math.max(0, Math.floor(((x + 0.5) * w) / size)))
        const sy = Math.min(h - 1, Math.max(0, Math.floor(((y + 0.5) * h) / size)))
        const o = (sy * w + sx) * 4
        for (let c = 0; c < 3; c += 1) {
          data[c * size * size + y * size + x] = src[o + c]! / 255
        }
      }
    }
    const name = session.inputNames[0]!
    const input = new ort.Tensor('float32', data, [1, 3, size, size])
    const t0 = Date.now()
    const outputs = await session.run({ [name]: input })
    const inferMs = Date.now() - t0
    const outName = session.outputNames[0]!
    const pred = outputs[outName]!.data as Float32Array
    // RMBG often already in [0,1]; detect logits vs probs.
    let max = -Infinity
    let min = Infinity
    for (let i = 0; i < pred.length; i += 1) {
      const v = pred[i]!
      if (v < min) min = v
      if (v > max) max = v
    }
    const asProb = max <= 1.5 && min >= -0.1
    const mask = logitsToMaskBuffer(
      pred,
      size,
      size,
      image.width,
      image.height,
      { alreadyProbability: asProb },
    )
    return { mask, inferMs }
  } catch (err) {
    console.warn('RMBG Node probe failed:', err)
    return null
  }
}

async function main() {
  if (!existsSync(weightsPath)) {
    throw new Error(`Missing weights: ${weightsPath}`)
  }
  const size = statSync(weightsPath).size
  if (size !== BIREFNET_ONNX_FP16_BYTES) {
    throw new Error(`Weight size ${size} ≠ ${BIREFNET_ONNX_FP16_BYTES}`)
  }
  const digest = createHash('sha256').update(readFileSync(weightsPath)).digest('hex')
  if (digest !== BIREFNET_ONNX_FP16_SHA256) {
    throw new Error(`SHA-256 mismatch: ${digest}`)
  }

  for (const sub of ['masks', 'transparent', 'beige', 'magenta', 'source', 'lab-masks']) {
    mkdirSync(join(outDir, sub), { recursive: true })
  }

  const weightBytes = readFileSync(weightsPath)
  const coldT0 = Date.now()
  const session = await ort.InferenceSession.create(weightBytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  const coldMs = Date.now() - coldT0
  const inputName = session.inputNames.includes(BIREFNET_INPUT_NAME)
    ? BIREFNET_INPUT_NAME
    : session.inputNames[0]!
  const outputName = session.outputNames.includes(BIREFNET_OUTPUT_NAME)
    ? BIREFNET_OUTPUT_NAME
    : session.outputNames[0]!

  let rmbgSession: ort.InferenceSession | null = null
  let rmbgNote = 'not loaded'
  if (existsSync(rmbgPath) && statSync(rmbgPath).size > 1_000_000) {
    try {
      rmbgSession = await ort.InferenceSession.create(readFileSync(rmbgPath), {
        executionProviders: ['wasm'],
      })
      rmbgNote = `loaded ${rmbgPath} inputs=${rmbgSession.inputNames.join(',')}`
    } catch (err) {
      rmbgNote = `load failed: ${err instanceof Error ? err.message : err}`
    }
  } else {
    rmbgNote = 'RMBG q8 mirror missing — RMBG column unmeasured in Node'
  }

  const rows: Record<string, unknown>[] = []
  let warmSum = 0
  let firstWarm: number | null = null

  for (const file of FIXTURES) {
    const srcPath = join(clothingDir, file)
    if (!existsSync(srcPath)) {
      console.warn('skip missing fixture', file)
      continue
    }
    copyFileSync(srcPath, join(outDir, 'source', file))
    const image = decodeJpeg(srcPath)
    const n = image.width * image.height

    const { mask, inferMs, logitsLen } = await runBiref(
      session,
      image,
      inputName,
      outputName,
    )
    warmSum += inferMs
    if (firstWarm === null) firstWarm = inferMs

    // Session reuse: second pass on same image (timing only).
    const reuse = await runBiref(session, image, inputName, outputName)

    const lab = await runAutoMaskPipeline(image, 'auto')
    const ref = buildIndependentReferenceMask(image)
    const refCov = summarizeReferenceCoverage(ref)
    const bin = computeBinaryMetrics(mask, ref)
    const boundary = computeBoundaryMetrics(mask, ref, 2)
    const holes = computeInternalHoleError(mask, ref, image)
    const labBin = computeBinaryMetrics(lab.mask, ref)
    const labHoles = computeInternalHoleError(lab.mask, ref, image)

    const rmbg = await tryRmbgMask(rmbgSession, image)
    const rmbgBin = rmbg ? computeBinaryMetrics(rmbg.mask, ref) : null

    writePng(
      join(outDir, 'masks', file.replace('.jpg', '-mask.png')),
      image.width,
      image.height,
      maskToRgba(mask),
    )
    writePng(
      join(outDir, 'lab-masks', file.replace('.jpg', '-lab-mask.png')),
      image.width,
      image.height,
      maskToRgba(lab.mask),
    )
    writePng(
      join(outDir, 'transparent', file.replace('.jpg', '-cutout.png')),
      image.width,
      image.height,
      transparentComposite(image.data, mask.data),
    )
    const beige = compositePixelBuffers(image.data, fillBg(n, BEIGE), mask.data)
    const magenta = compositePixelBuffers(
      image.data,
      fillBg(n, MAGENTA),
      mask.data,
    )
    writePng(
      join(outDir, 'beige', file.replace('.jpg', '-beige.png')),
      image.width,
      image.height,
      beige,
    )
    writePng(
      join(outDir, 'magenta', file.replace('.jpg', '-magenta.png')),
      image.width,
      image.height,
      magenta,
    )

    const flags = qualitativeFlags(file, mask, holes.internalHoleComponents)

    rows.push({
      fixture: file,
      backend: BIREFNET_METHOD,
      provider: 'onnxruntime-web-wasm',
      inputName,
      outputName,
      logitsLen,
      keepPct: keepPct(mask),
      softPct: softPct(mask),
      inferMs,
      reuseInferMs: reuse.inferMs,
      birefVsRefIoU: bin.iou,
      birefEdgeAcc: boundary.edgeAccuracy,
      birefHoleProxy: holes,
      labMethod: lab.methodUsed,
      labKeepPct: keepPct(lab.mask),
      labVsRefIoU: labBin.iou,
      labHoleProxy: labHoles,
      rmbgInferMs: rmbg?.inferMs ?? null,
      rmbgVsRefIoU: rmbgBin?.iou ?? null,
      refCov,
      qualitativeFlags: flags,
      note:
        'Reference mask is appearance+border heuristic — IoU is comparative, not absolute GT accuracy.',
    })
    console.log(
      `${file}: BiRefNet ${inferMs}ms keep=${keepPct(mask)}% IoU=${bin.iou.toFixed(3)} labIoU=${labBin.iou.toFixed(3)}`,
    )
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    weights: {
      path: weightsPath,
      bytes: BIREFNET_ONNX_FP16_BYTES,
      sha256: BIREFNET_ONNX_FP16_SHA256,
    },
    runtime: {
      stack: 'onnxruntime-web Node WASM (browser-class; WebGPU not available in this Node harness)',
      coldSessionMs: coldMs,
      firstInferMs: firstWarm,
      meanWarmInferMs: rows.length
        ? Math.round(warmSum / rows.length)
        : null,
      sessionReuseConfirmed: true,
    },
    rmbgNodeProbe: rmbgNote,
    fixtures: rows,
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))

  const md = [
    '# BiRefNet clothing benchmark',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    '## Runtime',
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Backend | \`${BIREFNET_METHOD}\` |`,
    `| Provider | onnxruntime-web **WASM** (Node harness) |`,
    `| Cold session | ${coldMs} ms |`,
    `| Mean warm infer | ${summary.runtime.meanWarmInferMs} ms |`,
    `| Weight SHA-256 | \`${BIREFNET_ONNX_FP16_SHA256}\` |`,
    `| RMBG Node probe | ${rmbgNote} |`,
    '',
    '## Per-fixture (vs appearance+border reference — not pixel-perfect GT)',
    '',
    '| Fixture | BiRef keep% | BiRef IoU | Lab IoU | BiRef ms | Flags |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...rows.map((r) => {
      const row = r as Record<string, unknown>
      const flags = (row.qualitativeFlags as string[]).join('; ') || '—'
      return `| ${row.fixture} | ${row.keepPct} | ${(row.birefVsRefIoU as number).toFixed(3)} | ${(row.labVsRefIoU as number).toFixed(3)} | ${row.inferMs} | ${flags} |`
    }),
    '',
    '## Interpretation',
    '',
    '- Do **not** claim BiRefNet > Lab-seed / RMBG from this table alone without visual review of `magenta/` and `beige/`.',
    '- White sneakers / white tee IoU is often unreliable when the reference marks FG/BG as uncertain.',
    '- Handbag handle holes: inspect `transparent/09_handbag-cutout.png`.',
    '- Browser WebGPU timing is **unmeasured** in this Node run; use `scripts/verifyBirefNetBrowser.mts` for Chromium.',
    '',
  ].join('\n')
  writeFileSync(join(outDir, 'REPORT.md'), md)
  console.log('Wrote', join(outDir, 'REPORT.md'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
