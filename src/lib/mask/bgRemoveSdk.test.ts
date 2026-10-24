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
