import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllMasks, getMask } from '../mask/maskStore'

const birefMock = vi.fn(
  async (
    _blob: Blob,
    _width: number,
    _height: number,
    _opts?: unknown,
  ) => ({
    mask: {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0]),
    },
    methodUsed: 'birefnet-lite-512',
    provider: 'birefnet-onnx',
    confidence: 0.85,
    needsReview: false,
    reviewReasons: [],
    findings: [],
    diagnostics: {
      method: 'birefnet-lite-512',
      reviewProfile: 'neural' as const,
      needsReview: false,
      reviewReasons: [],
      findings: [],
      metrics: {
        width: 2,
        height: 1,
        pixels: 2,
        keepCount: 1,
        bgCount: 1,
        softCount: 0,
        keepRatio: 0.5,
        softRatio: 0,
        bgRatio: 0.5,
        borderBandPx: 2,
        borderKeepCount: 0,
        borderKeepRatio: 0,
        borderStudioKeepCount: 0,
        borderStudioRatio: 0,
        frameTouchKeepCount: 0,
        keepComponentCount: 1,
        largestKeepShare: 1,
        fragmentation: {
          totalComponents: 1,
          noiseComponents: 0,
          detailComponents: 0,
          majorComponents: 1,
          significantComponents: 1,
          detachedSignificantCount: 0,
          detachedSignificantAreaShare: 0,
          largestAreaPx: 1,
          largestAreaShare: 1,
          keepPixels: 1,
          noiseAreaPx: 8,
          majorShareThr: 0.02,
        },
        internalHoleRatio: 0,
        paleAmongKeep: 0,
        darkShareAmongKeep: 0,
        edgeHaloRatio: 0,
        studioLuma: 220,
        colorAware: true,
      },
      score: 0.85,
      heuristicScore: 0.85,
      resized: true,
    },
    genuineModelInference: true as const,
    device: 'wasm' as const,
    resized: true,
    elapsedMs: 1,
  }),
)

const rmbgMock = vi.fn(
  async (
    _blob: Blob,
    _width: number,
    _height: number,
    _opts?: unknown,
  ) => ({
    mask: {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([200, 10]),
    },
    methodUsed: 'bg-remove-sdk-rmbg1.4',
    provider: 'bg-remove-sdk',
    confidence: 0.7,
    needsReview: false,
    reviewReasons: [],
    findings: [],
    diagnostics: {
      method: 'bg-remove-sdk-rmbg1.4',
      reviewProfile: 'neural' as const,
      needsReview: false,
      reviewReasons: [],
      findings: [],
      metrics: {
        width: 2,
        height: 1,
        pixels: 2,
        keepCount: 1,
        bgCount: 1,
        softCount: 0,
        keepRatio: 0.5,
        softRatio: 0,
        bgRatio: 0.5,
        borderBandPx: 2,
        borderKeepCount: 0,
        borderKeepRatio: 0,
        borderStudioKeepCount: 0,
        borderStudioRatio: 0,
        frameTouchKeepCount: 0,
        keepComponentCount: 1,
        largestKeepShare: 1,
        fragmentation: {
          totalComponents: 1,
          noiseComponents: 0,
          detailComponents: 0,
          majorComponents: 1,
          significantComponents: 1,
          detachedSignificantCount: 0,
          detachedSignificantAreaShare: 0,
          largestAreaPx: 1,
          largestAreaShare: 1,
          keepPixels: 1,
          noiseAreaPx: 8,
          majorShareThr: 0.02,
        },
        internalHoleRatio: 0,
        paleAmongKeep: 0,
        darkShareAmongKeep: 0,
        edgeHaloRatio: 0,
        studioLuma: 220,
        colorAware: true,
      },
      score: 0.7,
      heuristicScore: 0.7,
      resized: false,
    },
    genuineModelInference: true as const,
    device: 'wasm' as const,
    resized: false,
    elapsedMs: 2,
  }),
)

vi.mock('../mask/birefNet', () => ({
  BIREFNET_METHOD: 'birefnet-lite-512',
  BIREFNET_PROVIDER: 'birefnet-onnx',
  segmentWithBirefNet: (
    blob: Blob,
    width: number,
    height: number,
    opts?: unknown,
  ) => birefMock(blob, width, height, opts),
}))

vi.mock('../mask/bgRemoveSdk', () => ({
  BG_REMOVE_SDK_METHOD: 'bg-remove-sdk-rmbg1.4',
  BG_REMOVE_SDK_PROVIDER: 'bg-remove-sdk',
  segmentWithBgRemoveSdk: (
    blob: Blob,
    width: number,
    height: number,
    opts?: unknown,
  ) => rmbgMock(blob, width, height, opts),
}))

vi.mock('../image/loadHtmlImage', () => ({
  loadHtmlImage: vi.fn(async () => ({ naturalWidth: 2, naturalHeight: 1 })),
}))

vi.mock('../image/imageDataFromUrl', () => ({
  imageDataFromObjectUrl: vi.fn(async () => ({
    width: 2,
    height: 1,
    data: new Uint8ClampedArray(8),
    colorSpace: 'srgb',
  })),
}))

describe('autoMaskCornersForImage — BiRefNet default', () => {
  beforeEach(() => {
    clearAllMasks()
    birefMock.mockClear()
    rmbgMock.mockClear()
  })

  it('uses BiRefNet by default and commits the mask', async () => {
    const { autoMaskCornersForImage } = await import('./autoMaskCorners')
    const result = await autoMaskCornersForImage(
      'img-a',
      'blob:test',
      2,
      1,
      40,
      undefined,
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
    )
    expect(result.methodUsed).toBe('birefnet-lite-512')
    expect(result.requestedMethod).toBe('birefnet')
    expect(birefMock).toHaveBeenCalled()
    expect(rmbgMock).not.toHaveBeenCalled()
    expect(getMask('img-a')?.data[0]).toBe(255)
  })

  it('falls back to RMBG when BiRefNet throws, with explicit reason', async () => {
    birefMock.mockRejectedValueOnce(new Error('weights missing'))
    const { autoMaskCornersForImage } = await import('./autoMaskCorners')
    const result = await autoMaskCornersForImage(
      'img-b',
      'blob:test',
      2,
      1,
      40,
      undefined,
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
    )
    expect(result.methodUsed).toBe('bg-remove-sdk-rmbg1.4')
    expect(result.fallbackFrom).toBe('birefnet-lite-512')
    expect(result.fallbackReason).toMatch(/weights missing/i)
    expect(result.reviewReason).toMatch(/fallback from BiRefNet/i)
    expect(rmbgMock).toHaveBeenCalled()
  })

  it('can force RMBG without attempting BiRefNet', async () => {
    const { autoMaskCornersForImage } = await import('./autoMaskCorners')
    const result = await autoMaskCornersForImage(
      'img-c',
      'blob:test',
      2,
      1,
      40,
      undefined,
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
      'rmbg1.4',
    )
    expect(result.methodUsed).toBe('bg-remove-sdk-rmbg1.4')
    expect(result.requestedMethod).toBe('rmbg1.4')
    expect(birefMock).not.toHaveBeenCalled()
    expect(rmbgMock).toHaveBeenCalled()
  })
})
