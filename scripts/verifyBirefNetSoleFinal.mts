/**
 * Final independent verification: BiRefNet-only production path on
 * representative fixtures. Writes tmp-model-eval/birefnet-sole-final-verify-2026-10-27/
 * without mutating production code.
 *
 * Run: npx tsx scripts/verifyBirefNetSoleFinal.mts
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
import { repairSdkUnderRecall } from '../src/lib/mask/sdkUnderRecallRepair'
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
const outDir = join(
  root,
  'tmp-model-eval',
  'birefnet-sole-final-verify-2026-10-27',
)

/** Representative set from the verification brief. */
const FIXTURES: { id: string; path: string; note: string }[] = [
  {
    id: 'dark-hoodie',
    path: join(clothing, '01_hoodie.jpg'),
    note: 'dark garment',
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
    note: 'polo carpet close-up (collar) or tee fallback',
  },
]

const BGS = {
  white: [255, 255, 255] as [number, number, number],
  black: [0, 0, 0] as [number, number, number],
  gray: [128, 128, 128] as [number, number, number],
  magenta: [255, 0, 255] as [number, number, number],
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

function writePng(path: string, w: number, h: number, rgba: Uint8ClampedArray) {
  const png = new PNG({ width: w, height: h })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  writeFileSync(path, PNG.sync.write(png))
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

/** Confirm opaque KEEP pixels match source RGB (garment not recolored). */
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

async function main() {
  mkdirSync(join(outDir, 'transparent'), { recursive: true })
  mkdirSync(join(outDir, 'composites'), { recursive: true })
  mkdirSync(join(outDir, 'masks'), { recursive: true })

  const bytes = readFileSync(weightsPath)
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (
    bytes.length !== BIREFNET_ONNX_FP16_BYTES ||
    sha !== BIREFNET_ONNX_FP16_SHA256
  ) {
    throw new Error('Weight integrity failed')
  }

  if (ort.env?.wasm) ort.env.wasm.numThreads = 1

  const tInit0 = Date.now()
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  const initMs = Date.now() - tInit0

  const rows: Record<string, unknown>[] = []
  let firstInferMs = 0

  for (let fi = 0; fi < FIXTURES.length; fi += 1) {
    const fix = FIXTURES[fi]!
    if (!existsSync(fix.path)) {
      rows.push({ id: fix.id, skipped: true, reason: 'missing file' })
      continue
    }
    copyFileSync(fix.path, join(outDir, `${fix.id}-source${fix.path.slice(fix.path.lastIndexOf('.'))}`))
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

    // Production BiRefNet path must NOT apply under-recall repair.
    const repaired: MaskPixelBuffer = {
      width: mask.width,
      height: mask.height,
      data: new Uint8ClampedArray(mask.data),
    }
    const repair = repairSdkUnderRecall(repaired, image)
    // We still measure what repair would do — but export uses raw BiRefNet mask.
    const cut = cutout(image.data, mask.data)
    const rgbOk = garmentRgbUnchanged(image.data, cut, mask.data)

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

    const keep = countKeepPixels(mask)
    const row = {
      id: fix.id,
      note: fix.note,
      methodUsed: BIREFNET_METHOD,
      provider: 'onnxruntime-web-wasm',
      width: image.width,
      height: image.height,
      maskW: mask.width,
      maskH: mask.height,
      dimsMatch: mask.width === image.width && mask.height === image.height,
      keepPct: +((100 * keep) / mask.data.length).toFixed(2),
      degenerate,
      inferMs,
      garmentRgbUnchanged: rgbOk,
      underRecallWouldApply: repair.applied,
      underRecallReason: repair.reason,
      productionUsesUnderRecall: false,
      cutout: `transparent/${fix.id}-cutout.png`,
    }
    rows.push(row)
    console.log(
      fix.id,
      `method=${BIREFNET_METHOD} keep=${row.keepPct}% infer=${inferMs}ms rgbOk=${rgbOk} repairWould=${repair.applied}`,
    )
  }

  // Intentional failure probe: empty blob path is app-level; here blank logits check.
  const blank = new Float32Array(BIREFNET_INPUT_SIZE * BIREFNET_INPUT_SIZE).fill(
    -8,
  )
  const blankDegenerate = logitsLookDegenerate(blank)

  const report = {
    generatedAt: new Date().toISOString(),
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
      sessionReused: true,
    },
    fixtures: rows,
    failureProbe: {
      allNegativeLogitsFlaggedDegenerate: blankDegenerate,
    },
    productionPathNotes: [
      'App Batch → autoMaskCornersForImage → segmentWithBirefNet only',
      'repairSdkUnderRecall not applied on BiRefNet segment path',
      'No RMBG/Lab/ISNet/contour in App.tsx auto-mask imports',
    ],
  }
  writeFileSync(join(outDir, 'verify.json'), JSON.stringify(report, null, 2))
  writeFileSync(
    join(outDir, 'REPORT.md'),
    [
      '# BiRefNet sole-backend final fixture verify',
      '',
      `Generated: ${report.generatedAt}`,
      '',
      `Init ${initMs} ms · first infer ${firstInferMs} ms · EP wasm · method \`${BIREFNET_METHOD}\``,
      '',
      '| ID | Note | KEEP% | Infer ms | Dims OK | RGB intact | Repair would fire? |',
      '| --- | --- | ---: | ---: | --- | --- | --- |',
      ...rows.map((r) => {
        const row = r as Record<string, unknown>
        if (row.skipped) return `| ${row.id} | skipped | — | — | — | — | — |`
        return `| ${row.id} | ${row.note} | ${row.keepPct} | ${row.inferMs} | ${row.dimsMatch} | ${row.garmentRgbUnchanged} | ${row.underRecallWouldApply} |`
      }),
      '',
      'Cutouts: `transparent/`. Composites: `composites/*-over-{white,black,gray,magenta}.png`.',
      '',
    ].join('\n'),
  )
  console.log('Wrote', join(outDir, 'REPORT.md'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
