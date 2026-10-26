import { afterEach, describe, expect, it, vi } from 'vitest'
import { PNG } from 'pngjs'
import { createMaskBuffer } from './createMask'
import { MaskHistory } from './maskHistory'
import { paintMaskCircle } from './paintMask'
import { clearAllMasks, getMask, setMask } from './maskStore'

function makeTransparentPngBlob(
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number,
): Blob {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      png.data[i] = 40
      png.data[i + 1] = 50
      png.data[i + 2] = 60
      png.data[i + 3] = alphaAt(x, y)
    }
  }
  const bytes = Uint8Array.from(PNG.sync.write(png))
  return new Blob([bytes], { type: 'image/png' })
}

const processMock = vi.fn()
const preloadMock = vi.fn()
const onInitMock = vi.fn(() => () => undefined)
const disposeMock = vi.fn()

vi.mock('bg-remove-sdk', () => ({
  createBgRemover: vi.fn(() => ({
    process: processMock,
    preload: preloadMock,
    onInit: onInitMock,
    dispose: disposeMock,
    getState: () => ({ status: 'ready', device: 'wasm' }),
    init: vi.fn(),
    reload: vi.fn(),
  })),
}))

vi.mock('../image/imageDataFromUrl', () => ({
  imageDataFromObjectUrl: vi.fn(async (_url: string, w = 2, h = 1) => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i += 1) {
      data[i * 4] = 10
      data[i * 4 + 1] = 20
      data[i * 4 + 2] = 30
      data[i * 4 + 3] = 255
    }
    // Simulate decoded SDK PNG alpha already aligned: caller passes result blob URL.
    // For decodeBlobToRgba of processed PNG we still use this mock — set soft alpha
    // in channel layout by filling A from a simple pattern when size is 2x1.
    if (w === 2 && h === 1) {
      data[3] = 255
      data[7] = 90
    }
    return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData
  }),
}))

describe('segmentWithBgRemoveSdk (mocked SDK)', () => {
  afterEach(async () => {
    const { resetSharedBgRemoverForTests } = await import('./bgRemoveSdk')
    resetSharedBgRemoverForTests()
    processMock.mockReset()
    preloadMock.mockReset()
    onInitMock.mockReset()
    onInitMock.mockReturnValue(() => undefined)
    disposeMock.mockReset()
    vi.clearAllMocks()
  })

  it('uses shared createBgRemover, extracts KEEP alpha, never calls hosted APIs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    preloadMock.mockResolvedValue({ device: 'wasm' })
    processMock.mockResolvedValue({
      blob: makeTransparentPngBlob(2, 1, (x) => (x === 0 ? 255 : 90)),
      width: 2,
      height: 1,
    })

    const { segmentWithBgRemoveSdk, BG_REMOVE_SDK_METHOD } = await import(
      './bgRemoveSdk'
    )

    const result = await segmentWithBgRemoveSdk(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      2,
      1,
    )

    expect(preloadMock).toHaveBeenCalled()
    expect(processMock).toHaveBeenCalledOnce()
    expect(result.methodUsed).toBe(BG_REMOVE_SDK_METHOD)
    expect(result.genuineModelInference).toBe(true)
    expect(result.provider).toBe('bg-remove-sdk')
    expect(Array.from(result.mask.data)).toEqual([255, 90])
    expect(
      fetchSpy.mock.calls.some((c) =>
        /poof|remove\.bg|api\.remove/i.test(String(c[0])),
      ),
    ).toBe(false)
    fetchSpy.mockRestore()
  })

  it('reuses one remover instance across calls', async () => {
    preloadMock.mockResolvedValue({ device: 'webgpu' })
    processMock.mockResolvedValue({
      blob: makeTransparentPngBlob(2, 1, () => 255),
      width: 2,
      height: 1,
    })
    const { createBgRemover } = await import('bg-remove-sdk')
    const { segmentWithBgRemoveSdk, resetSharedBgRemoverForTests } =
      await import('./bgRemoveSdk')
    resetSharedBgRemoverForTests()
    vi.mocked(createBgRemover).mockClear()

    await segmentWithBgRemoveSdk(new Blob([new Uint8Array([1])]), 2, 1)
    await segmentWithBgRemoveSdk(new Blob([new Uint8Array([2])]), 2, 1)

    expect(createBgRemover).toHaveBeenCalledTimes(1)
    expect(processMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces model init failures clearly', async () => {
    preloadMock.mockRejectedValue(new Error('network down'))
    const { segmentWithBgRemoveSdk, resetSharedBgRemoverForTests } =
      await import('./bgRemoveSdk')
    resetSharedBgRemoverForTests()

    await expect(
      segmentWithBgRemoveSdk(new Blob([new Uint8Array([1])]), 2, 1),
    ).rejects.toThrow(/Model init failed/i)
  })

  it('retries q8 after WASM fp16 Out-of-memory backend init (same RMBG-1.4)', async () => {
    const oom = new Error(
      'no available backend found. ERR: [wasm] RangeError: Out of memory',
    )
    preloadMock.mockRejectedValueOnce(oom).mockResolvedValueOnce({ device: 'wasm' })
    processMock.mockResolvedValue({
      blob: makeTransparentPngBlob(2, 1, () => 255),
      width: 2,
      height: 1,
    })

    const { createBgRemover } = await import('bg-remove-sdk')
    const {
      segmentWithBgRemoveSdk,
      resetSharedBgRemoverForTests,
      getBgRemoveDiagnosticSnapshot,
      resetBgRemoveDiagnosticsForTests,
    } = await import('./bgRemoveSdk')
    resetSharedBgRemoverForTests()
    resetBgRemoveDiagnosticsForTests()
    vi.mocked(createBgRemover).mockClear()

    // Desktop UA → first attempt fp16; OOM triggers q8 retry.
    const result = await segmentWithBgRemoveSdk(
      new Blob([new Uint8Array([1])]),
      2,
      1,
    )
    expect(result.genuineModelInference).toBe(true)
    expect(preloadMock).toHaveBeenCalledTimes(2)
    expect(
      getBgRemoveDiagnosticSnapshot().events.some(
        (e) =>
          e.type === 'backend_fallback' &&
          e.detail?.includes('wasm-fp16-oom-retry-q8'),
      ),
    ).toBe(true)
    const dtypeCalls = vi.mocked(createBgRemover).mock.calls.map(
      (c) => (c[0] as { dtype?: string } | undefined)?.dtype,
    )
    expect(dtypeCalls).toContain('fp16')
    expect(dtypeCalls).toContain('q8')
  })

  it('retries WASM after a WebGPU-only backend init failure (same RMBG-1.4)', async () => {
    const webgpuErr = new Error(
      'no available backend found. ERR: [webgpu] TypeError: Importing a module script failed.',
    )
    preloadMock
      .mockRejectedValueOnce(webgpuErr)
      .mockResolvedValueOnce({ device: 'wasm' })
    processMock.mockResolvedValue({
      blob: makeTransparentPngBlob(2, 1, () => 255),
      width: 2,
      height: 1,
    })

    const { createBgRemover } = await import('bg-remove-sdk')
    const {
      segmentWithBgRemoveSdk,
      resetSharedBgRemoverForTests,
      getBgRemoveDiagnosticSnapshot,
      resetBgRemoveDiagnosticsForTests,
    } = await import('./bgRemoveSdk')
    resetSharedBgRemoverForTests()
    resetBgRemoveDiagnosticsForTests()
    vi.mocked(createBgRemover).mockClear()

    const result = await segmentWithBgRemoveSdk(
      new Blob([new Uint8Array([1])]),
      2,
      1,
    )

    expect(result.genuineModelInference).toBe(true)
    expect(result.device).toBe('wasm')
    expect(preloadMock).toHaveBeenCalledTimes(2)
    expect(createBgRemover).toHaveBeenCalled()
    const snap = getBgRemoveDiagnosticSnapshot()
    expect(
      snap.events.some(
        (e) =>
          e.type === 'backend_fallback' && e.detail?.includes('retry-wasm'),
      ),
    ).toBe(true)
    expect(disposeMock).toHaveBeenCalled()
  })

  it('creates remover with wasm preference on iPhone Safari UA', async () => {
    const originalUa = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () =>
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    })
    preloadMock.mockResolvedValue({ device: 'wasm' })
    processMock.mockResolvedValue({
      blob: makeTransparentPngBlob(2, 1, () => 255),
      width: 2,
      height: 1,
    })
    const { createBgRemover } = await import('bg-remove-sdk')
    const { segmentWithBgRemoveSdk, resetSharedBgRemoverForTests } =
      await import('./bgRemoveSdk')
    resetSharedBgRemoverForTests()
    vi.mocked(createBgRemover).mockClear()

    await segmentWithBgRemoveSdk(new Blob([new Uint8Array([1])]), 2, 1)

    expect(createBgRemover).toHaveBeenCalledWith(
      expect.objectContaining({ device: 'wasm', dtype: 'q8' }),
    )
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => originalUa,
    })
  })

  it('treats inference timeout as failure, not success', async () => {
    preloadMock.mockResolvedValue({ device: 'wasm' })
    processMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          // Simulate worker hang → app-level timeout rejects.
          setTimeout(
            () => reject(new Error('Local inference timed out after 120s.')),
            0,
          )
        }),
    )
    const { segmentWithBgRemoveSdk, resetSharedBgRemoverForTests } =
      await import('./bgRemoveSdk')
    resetSharedBgRemoverForTests()

    await expect(
      segmentWithBgRemoveSdk(new Blob([new Uint8Array([1])]), 2, 1),
    ).rejects.toThrow(/timed out/i)
  })

  it('recovers the shared worker after a hung process so the next image can run', async () => {
    preloadMock.mockResolvedValue({ device: 'wasm' })
    processMock
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(
              () =>
                reject(new Error('Local inference timed out after 120s.')),
              0,
            )
          }),
      )
      .mockResolvedValueOnce({
        blob: makeTransparentPngBlob(2, 1, () => 255),
        width: 2,
        height: 1,
      })

    const { createBgRemover } = await import('bg-remove-sdk')
    const {
      segmentWithBgRemoveSdk,
      resetSharedBgRemoverForTests,
      getBgRemoveDiagnosticSnapshot,
      resetBgRemoveDiagnosticsForTests,
    } = await import('./bgRemoveSdk')
    resetSharedBgRemoverForTests()
    resetBgRemoveDiagnosticsForTests()
    vi.mocked(createBgRemover).mockClear()

    await expect(
      segmentWithBgRemoveSdk(new Blob([new Uint8Array([1])]), 2, 1),
    ).rejects.toThrow(/timed out/i)
    expect(disposeMock).toHaveBeenCalled()
    expect(
      getBgRemoveDiagnosticSnapshot().events.some(
        (e) => e.type === 'recover_worker',
      ),
    ).toBe(true)

    // Fresh shared instance after recover.
    await expect(
      segmentWithBgRemoveSdk(new Blob([new Uint8Array([2])]), 2, 1),
    ).resolves.toMatchObject({ genuineModelInference: true })
    expect(createBgRemover).toHaveBeenCalled()
  })

  it('records process diagnostics without image payloads', async () => {
    preloadMock.mockResolvedValue({ device: 'webgpu' })
    processMock.mockImplementation(
      (_blob: Blob, _fmt: string, onProgress?: (p: { stage: string }) => void) => {
        onProgress?.({ stage: 'Running model…' })
        return Promise.resolve({
          blob: makeTransparentPngBlob(2, 1, () => 200),
          width: 2,
          height: 1,
        })
      },
    )
    const {
      segmentWithBgRemoveSdk,
      resetSharedBgRemoverForTests,
      getBgRemoveDiagnosticSnapshot,
      resetBgRemoveDiagnosticsForTests,
      formatSdkProcessStage,
    } = await import('./bgRemoveSdk')
    resetSharedBgRemoverForTests()
    resetBgRemoveDiagnosticsForTests()

    const stages: string[] = []
    await segmentWithBgRemoveSdk(new Blob([new Uint8Array([1])]), 2, 1, {
      onProgress: (e) => {
        if (e.kind === 'sdk-process') stages.push(e.stage)
      },
    })

    expect(formatSdkProcessStage('Running model…')).toMatch(/on-device inference/i)
    expect(stages.some((s) => /on-device inference/i.test(s))).toBe(true)
    const snap = getBgRemoveDiagnosticSnapshot()
    expect(snap.lastDevice).toBe('webgpu')
    expect(snap.events.some((e) => e.type === 'process_start')).toBe(true)
    expect(snap.events.some((e) => e.type === 'process_done')).toBe(true)
    expect(JSON.stringify(snap)).not.toMatch(/IMG_|password|token|VITE_/i)
  })
})

describe('SDK mask + manual edit / undo', () => {
  it('allows brush correction and undo after an SDK mask is stored', () => {
    clearAllMasks()
    const mask = createMaskBuffer(20, 20, 0)
    mask.data.fill(200)
    setMask('sdk-1', mask)
    const history = new MaskHistory()
    const current = getMask('sdk-1')!
    history.push(current)
    paintMaskCircle(current, 10, 10, 2, 'remove')
    setMask('sdk-1', current)
    expect(getMask('sdk-1')!.data[10 * 20 + 10]).toBe(0)
    const restored = history.undo(getMask('sdk-1')!)
    setMask('sdk-1', restored!)
    expect(getMask('sdk-1')!.data[10 * 20 + 10]).toBe(200)
  })
})
