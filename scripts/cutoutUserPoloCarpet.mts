/**
 * Apply BiRefNet (+ Lab-seed compare) to user-provided white-polo-on-carpet photos.
 * Writes transparent cutouts, gray masks, and magenta composites for background swap.
 *
 * Run: npx tsx scripts/cutoutUserPoloCarpet.mts
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
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
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_OUTPUT_NAME,
} from '../src/lib/mask/birefNet/constants'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import type { MaskPixelBuffer } from '../src/types/mask'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const assetsDir = join(
  root,
  '..',
  'Users',
  'KUMO',
  '.cursor',
  'projects',
  'd-project',
  'assets',
)
// Prefer absolute path from this machine.
const ASSETS = existsSync(
  'C:\\Users\\KUMO\\.cursor\\projects\\d-project\\assets',
)
  ? 'C:\\Users\\KUMO\\.cursor\\projects\\d-project\\assets'
  : assetsDir

const INPUTS = [
  '1-c876f59e-7876-4a49-ab7b-c4289895a5e0.png',
  '2-eb34fc43-0fdb-4fc6-b13f-75c9b3eb1d67.png',
  '3-0a909c79-ad67-4810-9ce3-6b8ded298a60.jpg',
  '4-9dc700c5-3659-41dd-acb0-9cda40f5096d.jpg',
  '5-84036e9c-9110-4258-ad23-aa710c174f0f.png',
  '6-ae1df537-23ee-447e-80cf-66691404e533.jpg',
  '7-10a39f2d-bb6d-41ea-b82b-e1f6c8451f63.jpg',
  '8-778f6a73-a109-428f-94a5-5bf39aa26b00.jpg',
] as const

const outDir = join(root, 'tmp-model-eval', 'polo-carpet-cutouts-2026-10-27')
const weightsPath = join(
  root,
  'public',
  'models',
  'studioludens',
  'birefnet-lite-512',
  'onnx',
  'model_fp16.onnx',
)

const MAGENTA: [number, number, number] = [255, 0, 255]
const BEIGE: [number, number, number] = [217, 196, 174]

function decodeImage(path: string): ImageData {
  const buf = readFileSync(path)
  const ext = extname(path).toLowerCase()
  if (ext === '.png') {
    const png = PNG.sync.read(buf)
    return {
      width: png.width,
      height: png.height,
      data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
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

function keepPct(mask: MaskPixelBuffer): number {
  return +((100 * countKeepPixels(mask)) / mask.data.length).toFixed(2)
}

function stem(file: string): string {
  const base = basename(file)
  const m = /^(\d+)-/.exec(base)
  return m ? `polo-${m[1]}` : base.replace(/\.[^.]+$/, '')
}

async function runBiref(
  session: ort.InferenceSession,
  image: ImageData,
): Promise<{ mask: MaskPixelBuffer; inferMs: number }> {
  const tensorData = preprocessImageDataToBirefNetTensor(image)
  const input = new ort.Tensor('float32', tensorData, [
    1,
    3,
    BIREFNET_INPUT_SIZE,
    BIREFNET_INPUT_SIZE,
  ])
  const t0 = Date.now()
  const outputs = await session.run({ [BIREFNET_INPUT_NAME]: input })
  const inferMs = Date.now() - t0
  const out = outputs[BIREFNET_OUTPUT_NAME]!
  const logits = out.data as Float32Array
  const dims = out.dims.map((d) => Number(d))
  const mh = dims.length >= 2 ? dims[dims.length - 2]! : BIREFNET_INPUT_SIZE
  const mw = dims.length >= 2 ? dims[dims.length - 1]! : BIREFNET_INPUT_SIZE
  const mask = logitsToMaskBuffer(logits, mw, mh, image.width, image.height)
  return { mask, inferMs }
}

async function main() {
  mkdirSync(join(outDir, 'transparent'), { recursive: true })
  mkdirSync(join(outDir, 'masks'), { recursive: true })
  mkdirSync(join(outDir, 'magenta'), { recursive: true })
  mkdirSync(join(outDir, 'beige'), { recursive: true })
  mkdirSync(join(outDir, 'lab-transparent'), { recursive: true })
  mkdirSync(join(outDir, 'sources'), { recursive: true })

  if (!existsSync(weightsPath)) throw new Error(`Missing ${weightsPath}`)
  const bytes = readFileSync(weightsPath)
  if (bytes.length !== BIREFNET_ONNX_FP16_BYTES) {
    throw new Error(`Unexpected weight size ${bytes.length}`)
  }

  console.log('Loading BiRefNet WASM…')
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })

  const rows: Record<string, unknown>[] = []

  for (const file of INPUTS) {
    const srcPath = join(ASSETS, file)
    if (!existsSync(srcPath)) {
      console.warn('SKIP missing', srcPath)
      continue
    }
    const id = stem(file)
    copyFileSync(srcPath, join(outDir, 'sources', `${id}${extname(file)}`))
    const image = decodeImage(srcPath)
    console.log(id, `${image.width}x${image.height}`)

    const { mask, inferMs } = await runBiref(session, image)
    const lab = await runAutoMaskPipeline(image)

    writePng(
      join(outDir, 'masks', `${id}-biref-mask.png`),
      mask.width,
      mask.height,
      maskToRgba(mask),
    )
    writePng(
      join(outDir, 'masks', `${id}-lab-mask.png`),
      lab.mask.width,
      lab.mask.height,
      maskToRgba(lab.mask),
    )

    const cutout = transparentComposite(image.data, mask.data)
    writePng(
      join(outDir, 'transparent', `${id}-biref-cutout.png`),
      image.width,
      image.height,
      cutout,
    )
    writePng(
      join(outDir, 'lab-transparent', `${id}-lab-cutout.png`),
      image.width,
      image.height,
      transparentComposite(image.data, lab.mask.data),
    )

    const n = image.width * image.height
    writePng(
      join(outDir, 'magenta', `${id}-biref.png`),
      image.width,
      image.height,
      compositePixelBuffers(image.data, mask.data, fillBg(n, MAGENTA)),
    )
    writePng(
      join(outDir, 'beige', `${id}-biref.png`),
      image.width,
      image.height,
      compositePixelBuffers(image.data, mask.data, fillBg(n, BEIGE)),
    )
    writePng(
      join(outDir, 'magenta', `${id}-lab.png`),
      image.width,
      image.height,
      compositePixelBuffers(image.data, lab.mask.data, fillBg(n, MAGENTA)),
    )

    const row = {
      id,
      source: file,
      width: image.width,
      height: image.height,
      birefKeepPct: keepPct(mask),
      birefMs: inferMs,
      labKeepPct: keepPct(lab.mask),
      labMethod: lab.methodUsed ?? lab.method ?? 'lab-seed',
      cutout: `transparent/${id}-biref-cutout.png`,
      note: 'White-on-beige carpet is hard; inspect cutouts before product use.',
    }
    rows.push(row)
    console.log(
      id,
      `BiRef keep=${row.birefKeepPct}% ${inferMs}ms | Lab keep=${row.labKeepPct}%`,
    )
  }

  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ rows }, null, 2))
  writeFileSync(
    join(outDir, 'README.md'),
    [
      '# White polo on carpet — BiRefNet cutouts',
      '',
      'Use `transparent/*-biref-cutout.png` as RGBA sources for new backgrounds',
      '(alpha = KEEP soft mask). Compare `lab-transparent/` when BiRefNet frays.',
      '',
      '| ID | BiRef KEEP% | Lab KEEP% | BiRef ms | Cutout |',
      '| --- | ---: | ---: | ---: | --- |',
      ...rows.map((r) => {
        const row = r as Record<string, unknown>
        return `| ${row.id} | ${row.birefKeepPct} | ${row.labKeepPct} | ${row.birefMs} | \`${row.cutout}\` |`
      }),
      '',
      'Magenta / beige composites are for edge inspection only.',
      '',
    ].join('\n'),
  )
  console.log('Wrote', outDir)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
