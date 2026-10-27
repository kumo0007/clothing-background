/**
 * Optional real-weight BiRefNet smoke. Skips unless:
 *   BIREFNET_INTEGRATION=1
 * and `public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx` exists (≥80 MB).
 *
 * Run: BIREFNET_INTEGRATION=1 npx vitest run src/lib/mask/birefNet/birefNet.integration.test.ts
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BIREFNET_METHOD, BIREFNET_ONNX_FP16_PATH } from './constants'

const enabled = process.env.BIREFNET_INTEGRATION === '1'
const weightPath = join(
  process.cwd(),
  'public',
  BIREFNET_ONNX_FP16_PATH.replace(/^\//, ''),
)
const weightsReady =
  existsSync(weightPath) && statSync(weightPath).size >= 80_000_000

describe.runIf(enabled && weightsReady)(
  'BiRefNet real-model integration',
  () => {
    it(
      'loads session and segments a small RGB fixture',
      async () => {
        // jsdom lacks WebGPU; force WASM via navigator.gpu absence (default).
        const { segmentWithBirefNet, disposeBirefNetSession } = await import(
          './index'
        )
        const size = 64
        const data = new Uint8ClampedArray(size * size * 4)
        for (let i = 0; i < size * size; i += 1) {
          const o = i * 4
          const x = i % size
          const y = Math.floor(i / size)
          const inFg =
            (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size * 0.28) ** 2
          data[o] = inFg ? 40 : 240
          data[o + 1] = inFg ? 40 : 240
          data[o + 2] = inFg ? 40 : 240
          data[o + 3] = 255
        }
        const source = new ImageData(data, size, size)
        const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
        const result = await segmentWithBirefNet(blob, size, size, {
          sourceImageData: source,
        })
        expect(result.methodUsed).toBe(BIREFNET_METHOD)
        expect(result.mask.width).toBe(size)
        expect(result.mask.height).toBe(size)
        expect(result.genuineModelInference).toBe(true)
        await disposeBirefNetSession()
      },
      180_000,
    )
  },
)

describe.runIf(!enabled || !weightsReady)(
  'BiRefNet real-model integration (skipped)',
  () => {
    it('documents how to enable the optional GPU/weight test', () => {
      expect(enabled && weightsReady).toBe(false)
    })
  },
)
