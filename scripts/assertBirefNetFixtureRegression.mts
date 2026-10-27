/**
 * Pixel-level BiRefNet fixture regression (KEEP% + full mask SHA-256).
 * Uses the same Node WASM path as production preprocess/postprocess.
 *
 * Run: npx tsx scripts/assertBirefNetFixtureRegression.mts
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
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
  BIREFNET_OUTPUT_NAME,
} from '../src/lib/mask/birefNet/constants'
import {
  BIREFNET_FIXTURE_KEEP_BASELINE,
  type BirefNetFixtureId,
} from '../src/lib/mask/birefNet/fixtureKeepBaseline'

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

const FIXTURES: { id: BirefNetFixtureId; path: string }[] = [
  { id: 'dark-hoodie', path: join(clothing, '01_hoodie.jpg') },
  { id: 'white-tshirt', path: join(clothing, '03_tshirt.jpg') },
  { id: 'white-sneakers', path: join(clothing, '08_sneakers.jpg') },
  { id: 'open-handbag', path: join(clothing, '09_handbag.jpg') },
  {
    id: 'polo-carpet-closeup',
    path: existsSync(poloSrc) ? poloSrc : join(clothing, '03_tshirt.jpg'),
  },
]

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

async function main() {
  const bytes = readFileSync(weightsPath)
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (
    bytes.length !== BIREFNET_ONNX_FP16_BYTES ||
    sha !== BIREFNET_ONNX_FP16_SHA256
  ) {
    throw new Error('Weight integrity failed')
  }
  if (ort.env?.wasm) ort.env.wasm.numThreads = 1

  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })

  const rows: Record<string, unknown>[] = []
  for (const fix of FIXTURES) {
    const image = decodeImage(fix.path)
    const tensor = preprocessImageDataToBirefNetTensor(image)
    const outputs = await session.run({
      [BIREFNET_INPUT_NAME]: new ort.Tensor('float32', tensor, [
        1,
        3,
        BIREFNET_INPUT_SIZE,
        BIREFNET_INPUT_SIZE,
      ]),
    })
    const mask = logitsToMaskBuffer(
      outputs[BIREFNET_OUTPUT_NAME]!.data as Float32Array,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
      image.width,
      image.height,
    )
    assertUsableMask(mask)
    const keepPct = +((100 * countKeepPixels(mask)) / mask.data.length).toFixed(
      2,
    )
    const maskSha256 = createHash('sha256')
      .update(Buffer.from(mask.data))
      .digest('hex')
    const expected = BIREFNET_FIXTURE_KEEP_BASELINE[fix.id]
    const keepOk = keepPct === expected.keepPct
    const shaOk = maskSha256 === expected.maskSha256
    rows.push({
      id: fix.id,
      keepPct,
      expectedKeepPct: expected.keepPct,
      keepOk,
      maskSha256,
      expectedSha: expected.maskSha256,
      shaOk,
    })
    console.log(
      fix.id,
      `keep=${keepPct} (expect ${expected.keepPct})`,
      keepOk && shaOk ? 'OK' : 'FAIL',
    )
    if (!keepOk || !shaOk) {
      throw new Error(
        `BiRefNet fixture regression on ${fix.id}: keepOk=${keepOk} shaOk=${shaOk}`,
      )
    }
  }
  console.log(JSON.stringify({ ok: true, fixtures: rows }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
