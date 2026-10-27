/**
 * Compare WASM numThreads for warm session.run (same tensor).
 * Leaves production untouched — measurement only.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import * as ort from 'onnxruntime-web'
import { preprocessImageDataToBirefNetTensor } from '../src/lib/mask/birefNet/preprocess'
import {
  countKeepPixels,
  logitsToMaskBuffer,
} from '../src/lib/mask/birefNet/postprocess'
import {
  BIREFNET_INPUT_NAME,
  BIREFNET_INPUT_SIZE,
  BIREFNET_OUTPUT_NAME,
} from '../src/lib/mask/birefNet/constants'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const weights = readFileSync(
  join(
    root,
    'public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx',
  ),
)
const jpg = readFileSync(join(root, 'public/testdata/clothing/08_sneakers.jpg'))
const decoded = jpeg.decode(jpg, { useTArray: true, formatAsRGBA: true })
const image = {
  width: decoded.width,
  height: decoded.height,
  data: new Uint8ClampedArray(
    decoded.data.buffer,
    decoded.data.byteOffset,
    decoded.data.byteLength,
  ),
  colorSpace: 'srgb',
} as ImageData
const tensor = preprocessImageDataToBirefNetTensor(image)

async function bench(threads: number) {
  if (ort.env?.wasm) ort.env.wasm.numThreads = threads
  const session = await ort.InferenceSession.create(weights, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  const feed = () => ({
    [BIREFNET_INPUT_NAME]: new ort.Tensor('float32', tensor, [
      1,
      3,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
    ]),
  })
  // warmup
  await session.run(feed())
  const times: number[] = []
  let keep = 0
  for (let i = 0; i < 3; i += 1) {
    const t0 = performance.now()
    const out = await session.run(feed())
    times.push(performance.now() - t0)
    const mask = logitsToMaskBuffer(
      out[BIREFNET_OUTPUT_NAME]!.data as Float32Array,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
      image.width,
      image.height,
    )
    keep = countKeepPixels(mask)
  }
  if ('release' in session) {
    await (session as { release?: () => Promise<void> }).release?.()
  }
  return {
    threads,
    timesMs: times.map((t) => +t.toFixed(1)),
    meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1),
    keep,
  }
}

const results = []
for (const n of [1, 2, 4]) {
  results.push(await bench(n))
  console.log(results[results.length - 1])
}
const keeps = new Set(results.map((r) => r.keep))
console.log(
  JSON.stringify(
    {
      results,
      keepIdentical: keeps.size === 1,
      best: [...results].sort((a, b) => a.meanMs - b.meanMs)[0],
    },
    null,
    2,
  ),
)
