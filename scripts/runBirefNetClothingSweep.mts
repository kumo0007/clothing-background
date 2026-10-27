/**
 * Isolated WASM sweep: 5 golden fixtures (SHA lock) + clothing + polo carpet set.
 * Does not change production. Writes cutouts under
 * tmp-model-eval/birefnet-hw-accel-2026-10-28/
 *
 * Run: npx tsx scripts/runBirefNetClothingSweep.mts
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, join } from 'node:path'
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
  BIREFNET_METHOD,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_SHA256,
  BIREFNET_OUTPUT_NAME,
} from '../src/lib/mask/birefNet/constants'
import {
  BIREFNET_FIXTURE_KEEP_BASELINE,
  type BirefNetFixtureId,
} from '../src/lib/mask/birefNet/fixtureKeepBaseline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'tmp-model-eval/birefnet-hw-accel-2026-10-28')
const clothing = join(root, 'public/testdata/clothing')
const poloDir = join(
  root,
  'tmp-model-eval/polo-carpet-hw-accel-2026-10-28/sources',
)
const weightsPath = join(
  root,
  'public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx',
)

const GOLDEN: { id: BirefNetFixtureId; path: string }[] = [
  { id: 'dark-hoodie', path: join(clothing, '01_hoodie.jpg') },
  { id: 'white-tshirt', path: join(clothing, '03_tshirt.jpg') },
  { id: 'white-sneakers', path: join(clothing, '08_sneakers.jpg') },
  { id: 'open-handbag', path: join(clothing, '09_handbag.jpg') },
  {
    id: 'polo-carpet-closeup',
    path: existsSync(join(poloDir, 'polo-5.png'))
      ? join(poloDir, 'polo-5.png')
      : join(clothing, '03_tshirt.jpg'),
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

async function segment(
  session: ort.InferenceSession,
  image: ImageData,
): Promise<{
  mask: { width: number; height: number; data: Uint8ClampedArray }
  inferMs: number
  keepPct: number
  maskSha256: string
}> {
  const tensor = preprocessImageDataToBirefNetTensor(image)
  const t0 = performance.now()
  const outputs = await session.run({
    [BIREFNET_INPUT_NAME]: new ort.Tensor('float32', tensor, [
      1,
      3,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
    ]),
  })
  const inferMs = performance.now() - t0
  const mask = logitsToMaskBuffer(
    outputs[BIREFNET_OUTPUT_NAME]!.data as Float32Array,
    BIREFNET_INPUT_SIZE,
    BIREFNET_INPUT_SIZE,
    image.width,
    image.height,
  )
  assertUsableMask(mask)
  const keepPct = +((100 * countKeepPixels(mask)) / mask.data.length).toFixed(2)
  const maskSha256 = createHash('sha256')
    .update(Buffer.from(mask.data))
    .digest('hex')
  return { mask, inferMs, keepPct, maskSha256 }
}

async function main() {
  mkdirSync(join(outDir, 'golden'), { recursive: true })
  mkdirSync(join(outDir, 'clothing'), { recursive: true })
  mkdirSync(join(outDir, 'polo'), { recursive: true })

  const bytes = readFileSync(weightsPath)
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (
    bytes.length !== BIREFNET_ONNX_FP16_BYTES ||
    sha !== BIREFNET_ONNX_FP16_SHA256
  ) {
    throw new Error('Weight integrity failed')
  }
  if (ort.env?.wasm) ort.env.wasm.numThreads = 1

  const tInit = performance.now()
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  const initMs = +(performance.now() - tInit).toFixed(1)

  const goldenRows: Record<string, unknown>[] = []
  let goldenOk = true
  for (const fix of GOLDEN) {
    const image = decodeImage(fix.path)
    const { mask, inferMs, keepPct, maskSha256 } = await segment(session, image)
    const expected = BIREFNET_FIXTURE_KEEP_BASELINE[fix.id]
    const keepOk = keepPct === expected.keepPct
    const shaOk = maskSha256 === expected.maskSha256
    if (!keepOk || !shaOk) goldenOk = false
    const cut = cutout(image.data, mask.data)
    const rgbOk = garmentRgbUnchanged(image.data, cut, mask.data)
    writePng(
      join(outDir, 'golden', `${fix.id}-cutout.png`),
      image.width,
      image.height,
      cut,
    )
    writePng(
      join(outDir, 'golden', `${fix.id}-over-magenta.png`),
      image.width,
      image.height,
      composite(image.data, mask.data, [255, 0, 255]),
    )
    goldenRows.push({
      id: fix.id,
      keepPct,
      expectedKeepPct: expected.keepPct,
      keepOk,
      maskSha256,
      shaOk,
      rgbOk,
      inferMs: +inferMs.toFixed(1),
      method: BIREFNET_METHOD,
    })
    console.log(
      'golden',
      fix.id,
      keepOk && shaOk ? 'OK' : 'FAIL',
      `keep=${keepPct}`,
    )
  }

  // Broader clothing product shots (01–10)
  const clothingRows: Record<string, unknown>[] = []
  const clothingFiles = readdirSync(clothing)
    .filter((n) => /^\d{2}_.*\.(jpe?g|png)$/i.test(n) && !n.includes('living'))
    .filter((n) => {
      const num = Number.parseInt(n.slice(0, 2), 10)
      return num >= 1 && num <= 10
    })
    .sort()

  for (const name of clothingFiles) {
    const path = join(clothing, name)
    const image = decodeImage(path)
    const { mask, inferMs, keepPct, maskSha256 } = await segment(session, image)
    const cut = cutout(image.data, mask.data)
    const rgbOk = garmentRgbUnchanged(image.data, cut, mask.data)
    const id = name.replace(/\.[^.]+$/, '')
    writePng(
      join(outDir, 'clothing', `${id}-cutout.png`),
      image.width,
      image.height,
      cut,
    )
    writePng(
      join(outDir, 'clothing', `${id}-over-magenta.png`),
      image.width,
      image.height,
      composite(image.data, mask.data, [255, 0, 255]),
    )
    clothingRows.push({
      id,
      keepPct,
      maskSha256,
      rgbOk,
      dims: [image.width, image.height],
      inferMs: +inferMs.toFixed(1),
      dimsMatch: mask.width === image.width && mask.height === image.height,
    })
    console.log('clothing', id, `keep=${keepPct}%`, `infer=${inferMs.toFixed(0)}ms`)
  }

  // Polo carpet set
  const poloRows: Record<string, unknown>[] = []
  if (existsSync(poloDir)) {
    const poloFiles = readdirSync(poloDir)
      .filter((n) => /^polo-\d+\.(png|jpe?g)$/i.test(n))
      .sort()
    for (const name of poloFiles) {
      const path = join(poloDir, name)
      const image = decodeImage(path)
      const { mask, inferMs, keepPct, maskSha256 } = await segment(
        session,
        image,
      )
      const cut = cutout(image.data, mask.data)
      const rgbOk = garmentRgbUnchanged(image.data, cut, mask.data)
      const id = name.replace(/\.[^.]+$/, '')
      writePng(
        join(outDir, 'polo', `${id}-cutout.png`),
        image.width,
        image.height,
        cut,
      )
      writePng(
        join(outDir, 'polo', `${id}-over-magenta.png`),
        image.width,
        image.height,
        composite(image.data, mask.data, [255, 0, 255]),
      )
      poloRows.push({
        id,
        keepPct,
        maskSha256,
        rgbOk,
        dims: [image.width, image.height],
        inferMs: +inferMs.toFixed(1),
        dimsMatch: mask.width === image.width && mask.height === image.height,
        notes:
          id.includes('3') || id.includes('4') || id.includes('6') || id.includes('7') || id.includes('8')
            ? 'may include measuring tape as KEEP'
            : 'product-on-carpet',
      })
      console.log('polo', id, `keep=${keepPct}%`, `infer=${inferMs.toFixed(0)}ms`)
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    method: BIREFNET_METHOD,
    ep: 'wasm',
    initMs,
    goldenOk,
    golden: goldenRows,
    clothing: clothingRows,
    polo: poloRows,
    productionPathUnchanged: true,
  }
  writeFileSync(join(outDir, 'clothing-sweep.json'), JSON.stringify(report, null, 2))
  if (!goldenOk) {
    throw new Error('Golden fixture KEEP%/SHA regression — abort')
  }
  console.log('Wrote', join(outDir, 'clothing-sweep.json'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
