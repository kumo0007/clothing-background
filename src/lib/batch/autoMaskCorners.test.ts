import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllMasks, getMask } from '../mask/maskStore'

vi.mock('../mask/bgRemoveSdk', () => ({
  BG_REMOVE_SDK_METHOD: 'bg-remove-sdk-rmbg1.4',
  BG_REMOVE_SDK_PROVIDER: 'bg-remove-sdk',
  segmentWithBgRemoveSdk: vi.fn(async () => ({
    mask: {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0]),
    },
    methodUsed: 'bg-remove-sdk-rmbg1.4',
    provider: 'bg-remove-sdk',
    confidence: 0.8,
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
      score: 0.8,
      heuristicScore: 0.8,
      resized: false,
    },
    genuineModelInference: true as const,
    device: 'wasm' as const,
    resized: false,
    elapsedMs: 1,
  })),
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

describe('autoMaskCornersForImage — bg-remove-sdk', () => {
  beforeEach(() => {
    clearAllMasks()
    vi.unstubAllGlobals()
  })

  it('commits SDK KEEP mask without calling Poof / remove.bg', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'blob:test') {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        })
      }
      return new Response('unexpected', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { autoMaskCornersForImage } = await import('./autoMaskCorners')
    const result = await autoMaskCornersForImage('img-a', 'blob:test', 2, 1)

    expect(result.requestedMethod).toBe('sdk')
    expect(result.genuineModelInference).toBe(true)
    expect(result.methodUsed).toBe('bg-remove-sdk-rmbg1.4')
    expect(Array.from(getMask('img-a')!.data)).toEqual([255, 0])
    expect(
      fetchMock.mock.calls.some((c) =>
        /poof|remove\.bg|\/api\/remove-background/i.test(String(c[0])),
      ),
    ).toBe(false)
  })
})
