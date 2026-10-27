/**
 * Full mask regression for the five fixtures. Skips unless:
 *   BIREFNET_FIXTURE_REGRESSION=1
 * and pinned FP16 weights are present (≥80 MB).
 *
 * Prefer: npx tsx scripts/assertBirefNetFixtureRegression.mts
 * Or: BIREFNET_FIXTURE_REGRESSION=1 npm test -- birefNet.fixtureRegression
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import {
  BIREFNET_INPUT_NAME,
  BIREFNET_INPUT_SIZE,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_PATH,
  BIREFNET_ONNX_FP16_SHA256,
  BIREFNET_OUTPUT_NAME,
} from './constants'
import { BIREFNET_FIXTURE_KEEP_BASELINE } from './fixtureKeepBaseline'
import { preprocessImageDataToBirefNetTensor } from './preprocess'
import {
  assertUsableMask,
  countKeepPixels,
  logitsToMaskBuffer,
} from './postprocess'

const enabled = process.env.BIREFNET_FIXTURE_REGRESSION === '1'
const weightPath = join(
  process.cwd(),
  'public',
  BIREFNET_ONNX_FP16_PATH.replace(/^\//, ''),
)
const weightsReady =
  existsSync(weightPath) &&
  statSync(weightPath).size === BIREFNET_ONNX_FP16_BYTES

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

describe.runIf(enabled && weightsReady)(
  'BiRefNet fixture mask regression (real WASM)',
  () => {
    it(
      'matches locked KEEP% and mask SHA-256 for all five fixtures',
      async () => {
        const bytes = readFileSync(weightPath)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(
          BIREFNET_ONNX_FP16_SHA256,
        )
        const ort = await import('onnxruntime-web')
        if (ort.env?.wasm) ort.env.wasm.numThreads = 1
        const session = await ort.InferenceSession.create(bytes, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        })

        const clothing = join(process.cwd(), 'public', 'testdata', 'clothing')
        const polo = join(
          process.cwd(),
          'tmp-model-eval',
          'polo-carpet-cutouts-2026-10-27',
          'sources',
          'polo-5.png',
        )
        const fixtures = [
          ['dark-hoodie', join(clothing, '01_hoodie.jpg')],
          ['white-tshirt', join(clothing, '03_tshirt.jpg')],
          ['white-sneakers', join(clothing, '08_sneakers.jpg')],
          ['open-handbag', join(clothing, '09_handbag.jpg')],
          [
            'polo-carpet-closeup',
            existsSync(polo) ? polo : join(clothing, '03_tshirt.jpg'),
          ],
        ] as const

        for (const [id, path] of fixtures) {
          const image = decodeImage(path)
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
          const keepPct = +(
            (100 * countKeepPixels(mask)) /
            mask.data.length
          ).toFixed(2)
          const maskSha256 = createHash('sha256')
            .update(Buffer.from(mask.data))
            .digest('hex')
          const expected = BIREFNET_FIXTURE_KEEP_BASELINE[id]
          expect(keepPct).toBe(expected.keepPct)
          expect(maskSha256).toBe(expected.maskSha256)
        }
      },
      300_000,
    )
  },
)

describe.runIf(!enabled || !weightsReady)(
  'BiRefNet fixture mask regression (skipped)',
  () => {
    it('documents opt-in: BIREFNET_FIXTURE_REGRESSION=1 + assert script', () => {
      expect(BIREFNET_FIXTURE_KEEP_BASELINE['white-sneakers'].keepPct).toBe(34.5)
    })
  },
)
