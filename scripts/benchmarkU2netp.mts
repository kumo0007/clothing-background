/**
 * Clothing-fixture benchmark for U²-Netp ONNX (Apache-2.0 weights).
 * Compares against appearance+border reference labels and Lab-seed / ISNet
 * baselines from the same fixtures. Does not change production defaults.
 *
 * Run: npx vite-node scripts/benchmarkU2netp.mts
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import * as ort from 'onnxruntime-web'
import { createMaskBuffer } from '../src/lib/mask/createMask'
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
import type { MaskPixelBuffer } from '../src/types/mask'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const outDir = join(root, 'tmp-model-eval', 'u2netp-bench')
const weightsPath = join(root, 'tmp-model-eval', 'weights', 'u2netp.onnx')

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

const SIZE = 320
const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const
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

function sampleBilinear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  c: number,
): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const i00 = (y0 * w + x0) * 4 + c
  const i10 = (y0 * w + x1) * 4 + c
  const i01 = (y1 * w + x0) * 4 + c
  const i11 = (y1 * w + x1) * 4 + c
  const v00 = data[i00]!
  const v10 = data[i10]!
  const v01 = data[i01]!
  const v11 = data[i11]!
  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  )
}

/** rembg-compatible U²-Netp preprocess: RGB → NCHW ImageNet-normalized 320². */
function preprocess(image: ImageData): ort.Tensor {
  const { width: w, height: h, data } = image
  const out = new Float32Array(1 * 3 * SIZE * SIZE)
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const sx = ((x + 0.5) * w) / SIZE - 0.5
      const sy = ((y + 0.5) * h) / SIZE - 0.5
      const clampedX = Math.min(w - 1, Math.max(0, sx))
      const clampedY = Math.min(h - 1, Math.max(0, sy))
      for (let c = 0; c < 3; c += 1) {
        const v = sampleBilinear(data, w, h, clampedX, clampedY, c) / 255
        out[c * SIZE * SIZE + y * SIZE + x] = (v - MEAN[c]!) / STD[c]!
      }
    }
  }
  return new ort.Tensor('float32', out, [1, 3, SIZE, SIZE])
}

function postprocess(
  pred: Float32Array,
  srcW: number,
  srcH: number,
): MaskPixelBuffer {
  let mi = Infinity
  let ma = -Infinity
  for (let i = 0; i < pred.length; i += 1) {
    const v = pred[i]!
    if (v < mi) mi = v
    if (v > ma) ma = v
  }
  const range = ma - mi || 1
  const norm = new Float32Array(pred.length)
  for (let i = 0; i < pred.length; i += 1) {
    norm[i] = (pred[i]! - mi) / range
  }

  const mask = createMaskBuffer(srcW, srcH, 0)
  for (let y = 0; y < srcH; y += 1) {
    for (let x = 0; x < srcW; x += 1) {
      const sx = ((x + 0.5) * SIZE) / srcW - 0.5
      const sy = ((y + 0.5) * SIZE) / srcH - 0.5
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(SIZE - 1, Math.max(0, x0 + 1))
      const y1 = Math.min(SIZE - 1, Math.max(0, y0 + 1))
      const xx0 = Math.min(SIZE - 1, Math.max(0, x0))
      const yy0 = Math.min(SIZE - 1, Math.max(0, y0))
      const fx = sx - x0
      const fy = sy - y0
      const v00 = norm[yy0 * SIZE + xx0]!
      const v10 = norm[yy0 * SIZE + x1]!
      const v01 = norm[y1 * SIZE + xx0]!
      const v11 = norm[y1 * SIZE + x1]!
      const v =
        v00 * (1 - fx) * (1 - fy) +
        v10 * fx * (1 - fy) +
        v01 * (1 - fx) * fy +
        v11 * fx * fy
      mask.data[y * srcW + x] = Math.round(Math.min(1, Math.max(0, v)) * 255)
    }
  }
  return mask
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
  let k = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! >= 128) k += 1
  }
  return +((100 * k) / mask.data.length).toFixed(2)
}

function componentCount(mask: MaskPixelBuffer): number {
  const { width: w, data } = mask
  const h = data.length / w
  const seen = new Uint8Array(data.length)
  let count = 0
  for (let s = 0; s < data.length; s += 1) {
    if (seen[s] || data[s]! < 128) continue
    count += 1
    const q = [s]
    seen[s] = 1
    let head = 0
    while (head < q.length) {
      const i = q[head++]!
      const x = i % w
      const y = (i / w) | 0
      for (const n of [
        x > 0 ? i - 1 : -1,
        x + 1 < w ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y + 1 < h ? i + w : -1,
      ]) {
        if (n < 0 || seen[n] || data[n]! < 128) continue
        seen[n] = 1
        q.push(n)
      }
    }
  }
  return count
}

async function main() {
  mkdirSync(join(outDir, 'masks'), { recursive: true })
  mkdirSync(join(outDir, 'transparent'), { recursive: true })
  mkdirSync(join(outDir, 'beige'), { recursive: true })
  mkdirSync(join(outDir, 'magenta'), { recursive: true })
  mkdirSync(join(outDir, 'source'), { recursive: true })

  const weightBytes = readFileSync(weightsPath)
  const initT0 = Date.now()
  const session = await ort.InferenceSession.create(weightBytes)
  const initMs = Date.now() - initT0

  const rows: Record<string, unknown>[] = []
  let warmInferMs = 0

  for (const file of FIXTURES) {
    const srcPath = join(clothingDir, file)
    copyFileSync(srcPath, join(outDir, 'source', file))
    const image = decodeJpeg(srcPath)
    const n = image.width * image.height

    const prepT0 = Date.now()
    const input = preprocess(image)
    const prepMs = Date.now() - prepT0

    const inferT0 = Date.now()
    const outputs = await session.run({ 'input.1': input })
    const inferMs = Date.now() - inferT0
    warmInferMs += inferMs

    const firstName = session.outputNames[0]!
    const predTensor = outputs[firstName]!
    const pred = predTensor.data as Float32Array

    const postT0 = Date.now()
    const mask = postprocess(pred, image.width, image.height)
    const postMs = Date.now() - postT0

    const lab = await runAutoMaskPipeline(image, 'auto')
    const ref = buildIndependentReferenceMask(image)
    const refCov = summarizeReferenceCoverage(ref)
    const bin = computeBinaryMetrics(mask, ref)
    const boundary = computeBoundaryMetrics(mask, ref, 2)
    const holes = computeInternalHoleError(mask, ref, image)
    const labBin = computeBinaryMetrics(lab.mask, ref)

    writePng(
      join(outDir, 'masks', file.replace('.jpg', '-mask.png')),
      image.width,
      image.height,
      maskToRgba(mask),
    )
    writePng(
      join(outDir, 'transparent', file.replace('.jpg', '-cutout.png')),
      image.width,
      image.height,
      transparentComposite(image.data, mask.data),
    )
    const beigeBg = fillBg(n, BEIGE)
    const magBg = fillBg(n, MAGENTA)
    writePng(
      join(outDir, 'beige', file.replace('.jpg', '-beige.png')),
      image.width,
      image.height,
      compositePixelBuffers(image.data, mask.data, beigeBg),
    )
    writePng(
      join(outDir, 'magenta', file.replace('.jpg', '-magenta.png')),
      image.width,
      image.height,
      compositePixelBuffers(image.data, mask.data, magBg),
    )

    rows.push({
      file,
      size: `${image.width}x${image.height}`,
      timing: { prepMs, inferMs, postMs, totalMs: prepMs + inferMs + postMs },
      keepPct: keepPct(mask),
      softPct: softPct(mask),
      components: componentCount(mask),
      u2netp: {
        iou: bin.iou,
        fgRecall: bin.fgRecall,
        bgContaminationRate: bin.bgContaminationRate,
        garmentMissRate: bin.garmentMissRate,
        edgeAccuracy: boundary.edgeAccuracy,
        softAlphaMae: boundary.softAlphaMae,
        internalHoleErrorPixels: holes.internalHoleErrorPixels,
      },
      labSeed: {
        iou: labBin.iou,
        methodUsed: lab.methodUsed,
      },
      refCoverage: refCov,
      sourceRgbUnchanged: true,
    })

    console.log(
      file,
      'iou',
      bin.iou,
      'lab',
      labBin.iou,
      'inferMs',
      inferMs,
      'keep%',
      keepPct(mask),
      'comp',
      componentCount(mask),
    )
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    model: {
      id: 'u2netp',
      weightsPath: 'tmp-model-eval/weights/u2netp.onnx',
      sha256:
        '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
      bytes: weightBytes.byteLength,
      license: 'Apache-2.0',
      input: 'input.1 [1,3,320,320]',
      outputUsed: session.outputNames[0],
      runtime: 'onnxruntime-web (Node WASM)',
    },
    timings: {
      sessionCreateMs: initMs,
      sumWarmInferMs: warmInferMs,
      meanWarmInferMs: Math.round(warmInferMs / FIXTURES.length),
    },
    rows,
  }

  writeFileSync(
    join(outDir, 'summary.json'),
    JSON.stringify(summary, null, 2),
  )

  const md = [
    '# U²-Netp clothing fixture benchmark',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    `Weights: \`${summary.model.weightsPath}\` (${(summary.model.bytes / 1024 / 1024).toFixed(2)} MiB, Apache-2.0)`,
    `Session create: ${initMs} ms · mean warm infer: ${summary.timings.meanWarmInferMs} ms (Node WASM)`,
    '',
    '| Fixture | U² IoU | Lab IoU | Δ | keep% | soft% | comps | inferMs |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((r) => {
      const u = r.u2netp as { iou: number | null }
      const l = r.labSeed as { iou: number | null }
      const ui = u.iou ?? 0
      const li = l.iou ?? 0
      return `| ${r.file} | ${ui.toFixed(3)} | ${li.toFixed(3)} | ${(ui - li).toFixed(3)} | ${r.keepPct} | ${r.softPct} | ${r.components} | ${(r.timing as { inferMs: number }).inferMs} |`
    }),
    '',
    'Reference = appearance+border definite labels (uncertain excluded). Not human GT.',
    'Visual exports: `tmp-model-eval/u2netp-bench/{masks,transparent,beige,magenta}/`.',
    '',
  ].join('\n')
  writeFileSync(join(outDir, 'BENCHMARK.md'), md)
  console.log('\nWrote', join(outDir, 'summary.json'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
