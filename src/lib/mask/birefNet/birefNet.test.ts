import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMaskBuffer } from '../createMask'
import {
  assertUsableMask,
  countKeepPixels,
  logitsLookDegenerate,
  logitsToMaskBuffer,
  sigmoid,
} from './postprocess'
import { preprocessImageDataToBirefNetTensor } from './preprocess'
import {
  BIREFNET_INPUT_SIZE,
  BIREFNET_MEAN,
  BIREFNET_METHOD,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_PROVIDER,
  BIREFNET_STD,
} from './constants'
import {
  resetBirefNetSessionForTests,
  setFetchBirefNetModelBytesForTests,
  setSharedBirefNetSessionForTests,
} from './session'

vi.mock('onnxruntime-web', () => {
  class FakeTensor {
    type: string
    data: Float32Array
    dims: number[]
    constructor(type: string, data: Float32Array, dims: number[]) {
      this.type = type
      this.data = data
      this.dims = dims
    }
  }
  return {
    Tensor: FakeTensor,
    InferenceSession: { create: vi.fn() },
    env: { wasm: { numThreads: 1 } },
  }
})

function solidImage(
  width: number,
  height: number,
  rgb: [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4
    data[o] = rgb[0]
    data[o + 1] = rgb[1]
    data[o + 2] = rgb[2]
    data[o + 3] = 255
  }
  return new ImageData(data, width, height)
}

describe('BiRefNet preprocess / postprocess', () => {
  it('sigmoid is stable and in (0,1)', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 5)
    expect(sigmoid(20)).toBeGreaterThan(0.999)
    expect(sigmoid(-20)).toBeLessThan(0.001)
    expect(Number.isFinite(sigmoid(1e6))).toBe(true)
    expect(Number.isFinite(sigmoid(-1e6))).toBe(true)
  })

  it('constants match studioludens preprocessor_config ImageNet mean/std + 512', () => {
    // Locked to public/models/studioludens/birefnet-lite-512/preprocessor_config.json
    expect(BIREFNET_MEAN).toEqual([0.485, 0.456, 0.406])
    expect(BIREFNET_STD).toEqual([0.229, 0.224, 0.225])
    expect(BIREFNET_INPUT_SIZE).toBe(512)
  })

  it('preprocess emits NCHW float32 of expected length', () => {
    const img = solidImage(40, 30, [200, 180, 160])
    const tensor = preprocessImageDataToBirefNetTensor(img)
    expect(tensor).toBeInstanceOf(Float32Array)
    expect(tensor.length).toBe(1 * 3 * BIREFNET_INPUT_SIZE * BIREFNET_INPUT_SIZE)
    expect(tensor.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('preprocess uses RGB channel order with ImageNet normalize (pixel/255)', () => {
    const size = 8
    const img = solidImage(4, 4, [255, 0, 128])
    const tensor = preprocessImageDataToBirefNetTensor(img, size)
    const plane = size * size
    const expectedR = (1 - BIREFNET_MEAN[0]!) / BIREFNET_STD[0]!
    const expectedG = (0 - BIREFNET_MEAN[1]!) / BIREFNET_STD[1]!
    const expectedB = (128 / 255 - BIREFNET_MEAN[2]!) / BIREFNET_STD[2]!
    // Sample center pixel of each NCHW plane.
    const mid = Math.floor(size / 2) * size + Math.floor(size / 2)
    expect(tensor[mid]!).toBeCloseTo(expectedR, 5)
    expect(tensor[plane + mid]!).toBeCloseTo(expectedG, 5)
    expect(tensor[2 * plane + mid]!).toBeCloseTo(expectedB, 5)
    // R plane differs from G (not BGR swapped).
    expect(tensor[mid]!).not.toBeCloseTo(tensor[plane + mid]!, 2)
  })

  it('preprocess does not mutate source ImageData', () => {
    const img = solidImage(8, 8, [10, 20, 30])
    const before = img.data.slice()
    preprocessImageDataToBirefNetTensor(img, 16)
    expect(Array.from(img.data)).toEqual(Array.from(before))
  })

  it('rejects invalid preprocess dimensions', () => {
    expect(() =>
      preprocessImageDataToBirefNetTensor({
        width: 0,
        height: 0,
        data: new Uint8ClampedArray(0),
        colorSpace: 'srgb',
      } as ImageData),
    ).toThrow(/invalid/i)
  })

  it('logitsToMaskBuffer applies sigmoid and KEEP=255 polarity', () => {
    const size = 4
    const logits = new Float32Array(size * size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        logits[y * size + x] = x < size / 2 ? 8 : -8
      }
    }
    const mask = logitsToMaskBuffer(logits, size, size, 8, 8)
    expect(mask.width).toBe(8)
    expect(mask.height).toBe(8)
    // Positive logit → KEEP (255); negative → BG (0). Not inverted.
    expect(mask.data[0]!).toBeGreaterThan(200)
    expect(mask.data[7]!).toBeLessThan(50)
    // Exact same-res path: logit 0 → ~128 after sigmoid*255.
    const zero = logitsToMaskBuffer(new Float32Array(4).fill(0), 2, 2, 2, 2)
    expect(zero.data[0]!).toBe(128)
  })

  it('alreadyProbability skips sigmoid (does not double-activate)', () => {
    const probs = new Float32Array([1, 0, 0.5, 0.25])
    const mask = logitsToMaskBuffer(probs, 2, 2, 2, 2, {
      alreadyProbability: true,
    })
    expect(mask.data[0]).toBe(255)
    expect(mask.data[1]).toBe(0)
    expect(mask.data[2]).toBe(128)
    expect(mask.data[3]).toBe(64)
  })

  it('handles non-finite logits without throwing', () => {
    const logits = new Float32Array([NaN, Infinity, -Infinity, 0])
    const mask = logitsToMaskBuffer(logits, 2, 2, 2, 2)
    expect(mask.data.every((v) => v >= 0 && v <= 255)).toBe(true)
  })

  it('assertUsableMask rejects empty KEEP', () => {
    const empty = createMaskBuffer(4, 4, 0)
    expect(() => assertUsableMask(empty)).toThrow(/empty KEEP/i)
  })

  it('detects degenerate all-negative logits', () => {
    expect(logitsLookDegenerate(new Float32Array(512).fill(-3))).toBe(true)
    const ok = new Float32Array(512)
    for (let i = 0; i < 512; i += 1) ok[i] = i < 200 ? 4 : -4
    expect(logitsLookDegenerate(ok)).toBe(false)
  })

  it('countKeepPixels uses 128 threshold', () => {
    const mask = createMaskBuffer(2, 1, 0)
    mask.data[0] = 127
    mask.data[1] = 128
    expect(countKeepPixels(mask)).toBe(1)
  })
})

describe('segmentWithBirefNet (mocked session)', () => {
  beforeEach(() => {
    resetBirefNetSessionForTests()
    setFetchBirefNetModelBytesForTests(async () => new Uint8Array(8))
  })
  afterEach(() => {
    setFetchBirefNetModelBytesForTests(null)
    resetBirefNetSessionForTests()
  })

  it('runs end-to-end with injected session and reports method', async () => {
    const size = BIREFNET_INPUT_SIZE
    const logits = new Float32Array(size * size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - size / 2
        const dy = y - size / 2
        logits[y * size + x] = dx * dx + dy * dy < (size * 0.3) ** 2 ? 6 : -6
      }
    }

    setSharedBirefNetSessionForTests({
      session: {
        inputNames: ['input_image'],
        outputNames: ['output_image'],
        run: async () => ({
          output_image: {
            data: logits,
            dims: [1, 1, size, size],
          },
        }),
      } as never,
      device: 'wasm',
      inputName: 'input_image',
      outputName: 'output_image',
    })

    const { segmentWithBirefNet } = await import('./segment')
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const result = await segmentWithBirefNet(blob, 32, 24, {
      sourceImageData: solidImage(32, 24, [220, 220, 220]),
    })

    expect(result.methodUsed).toBe(BIREFNET_METHOD)
    expect(result.provider).toBe(BIREFNET_PROVIDER)
    expect(result.genuineModelInference).toBe(true)
    expect(result.mask.width).toBe(32)
    expect(result.mask.height).toBe(24)
    expect(countKeepPixels(result.mask)).toBeGreaterThan(0)
    expect(result.device).toBe('wasm')
  })

  it('reuses the injected session across calls', async () => {
    const size = BIREFNET_INPUT_SIZE
    const logits = new Float32Array(size * size).fill(4)
    let runs = 0
    setSharedBirefNetSessionForTests({
      session: {
        inputNames: ['input_image'],
        outputNames: ['output_image'],
        run: async () => {
          runs += 1
          return {
            output_image: {
              data: logits,
              dims: [1, 1, size, size],
            },
          }
        },
      } as never,
      device: 'webgpu',
      inputName: 'input_image',
      outputName: 'output_image',
    })

    const { segmentWithBirefNet } = await import('./segment')
    const { preloadBirefNetModel } = await import('./session')
    const a = await preloadBirefNetModel()
    const b = await preloadBirefNetModel()
    expect(a).toBe(b)

    const blob = new Blob([new Uint8Array([9])], { type: 'image/png' })
    await segmentWithBirefNet(blob, 16, 16, {
      sourceImageData: solidImage(16, 16, [10, 10, 10]),
    })
    await segmentWithBirefNet(blob, 16, 16, {
      sourceImageData: solidImage(16, 16, [10, 10, 10]),
    })
    expect(runs).toBe(2)
  })

  it('keeps raw BiRefNet mask without under-recall repair notes', async () => {
    const size = BIREFNET_INPUT_SIZE
    const logits = new Float32Array(size * size).fill(5)
    setSharedBirefNetSessionForTests({
      session: {
        inputNames: ['input_image'],
        outputNames: ['output_image'],
        run: async () => ({
          output_image: {
            data: logits,
            dims: [1, 1, size, size],
          },
        }),
      } as never,
      device: 'wasm',
      inputName: 'input_image',
      outputName: 'output_image',
    })

    const { segmentWithBirefNet } = await import('./segment')
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' })
    const result = await segmentWithBirefNet(blob, 16, 16, {
      sourceImageData: solidImage(16, 16, [240, 240, 240]),
    })
    expect(
      result.reviewReasons.some((r) => /under-recall repair/i.test(r)),
    ).toBe(false)
    expect(countKeepPixels(result.mask)).toBe(result.mask.data.length)
  })

  it('surfaces inference failures without inventing a mask', async () => {
    setSharedBirefNetSessionForTests({
      session: {
        inputNames: ['input_image'],
        outputNames: ['output_image'],
        run: async () => {
          throw new Error('simulated ORT crash')
        },
      } as never,
      device: 'wasm',
      inputName: 'input_image',
      outputName: 'output_image',
    })

    const { segmentWithBirefNet } = await import('./segment')
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' })
    await expect(
      segmentWithBirefNet(blob, 8, 8, {
        sourceImageData: solidImage(8, 8, [40, 40, 40]),
      }),
    ).rejects.toThrow(/simulated ORT crash/i)
  })

  it('falls back WASM when WebGPU logits are degenerate (no silent KEEP=0)', async () => {
    const size = BIREFNET_INPUT_SIZE
    const bad = new Float32Array(size * size).fill(-4)
    const good = new Float32Array(size * size).fill(3)
    let webgpuRuns = 0
    let wasmCreateCalls = 0

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-length'
              ? String(BIREFNET_ONNX_FP16_BYTES)
              : null,
        },
      })),
    )

    setSharedBirefNetSessionForTests({
      session: {
        inputNames: ['input_image'],
        outputNames: ['output_image'],
        run: async () => {
          webgpuRuns += 1
          return {
            output_image: { data: bad, dims: [1, 1, size, size] },
          }
        },
      } as never,
      device: 'webgpu',
      inputName: 'input_image',
      outputName: 'output_image',
    })

    const ort = await import('onnxruntime-web')
    vi.mocked(ort.InferenceSession.create).mockImplementation(async () => {
      wasmCreateCalls += 1
      return {
        inputNames: ['input_image'],
        outputNames: ['output_image'],
        run: async () => ({
          output_image: { data: good, dims: [1, 1, size, size] },
        }),
      } as never
    })

    const { runBirefNetInference } = await import('./session')
    const input = new Float32Array(3 * size * size)
    const result = await runBirefNetInference(input)
    expect(webgpuRuns).toBe(1)
    expect(wasmCreateCalls).toBeGreaterThanOrEqual(1)
    expect(result.device).toBe('wasm')
    expect(result.fallbackReason).toMatch(/degenerate logits/i)
    expect(logitsLookDegenerate(result.logits)).toBe(false)
    expect(result.logits[0]).toBe(3)
    vi.unstubAllGlobals()
  })

  it('throws if WASM retry after WebGPU also looks degenerate', async () => {
    const size = BIREFNET_INPUT_SIZE
    const bad = new Float32Array(size * size).fill(-5)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-length'
              ? String(BIREFNET_ONNX_FP16_BYTES)
              : null,
        },
      })),
    )

    setSharedBirefNetSessionForTests({
      session: {
        inputNames: ['input_image'],
        outputNames: ['output_image'],
        run: async () => ({
          output_image: { data: bad, dims: [1, 1, size, size] },
        }),
      } as never,
      device: 'webgpu',
      inputName: 'input_image',
      outputName: 'output_image',
    })

    const ort = await import('onnxruntime-web')
    vi.mocked(ort.InferenceSession.create).mockImplementation(async () => {
      return {
        inputNames: ['input_image'],
        outputNames: ['output_image'],
        run: async () => ({
          output_image: { data: bad, dims: [1, 1, size, size] },
        }),
      } as never
    })

    const { runBirefNetInference } = await import('./session')
    await expect(
      runBirefNetInference(new Float32Array(3 * size * size)),
    ).rejects.toThrow(/WASM retry also produced degenerate logits/i)
    vi.unstubAllGlobals()
  })
})

describe('formatBirefNetInitFailureMessage', () => {
  it('names BiRefNet and ~94MB weights — never RMBG', async () => {
    const { formatBirefNetInitFailureMessage } = await import('./errors')
    const network = formatBirefNetInitFailureMessage('Failed to fetch')
    expect(network).toMatch(/BiRefNet/i)
    expect(network).toMatch(/~94MB/i)
    expect(network).not.toMatch(/RMBG/i)
    expect(network).not.toMatch(/44MB/i)

    const contentLength = formatBirefNetInitFailureMessage(
      'Content-Length header of network response exceeds response Body.',
    )
    expect(contentLength).toMatch(/BiRefNet/i)
    expect(contentLength).toMatch(/~94MB/i)
    expect(contentLength).not.toMatch(/RMBG/i)

    const preserved = formatBirefNetInitFailureMessage(
      'Model init failed (network down).',
    )
    expect(preserved).toBe('Model init failed (network down).')
  })
})

