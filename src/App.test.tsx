import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./utils/imageFiles', async () => {
  const actual = await vi.importActual<typeof import('./utils/imageFiles')>(
    './utils/imageFiles',
  )
  return {
    ...actual,
    loadImageDimensions: vi.fn(async () => ({ width: 40, height: 30 })),
  }
})

const autoMaskMock = vi.fn()
vi.mock('./lib/batch/autoMaskCorners', () => ({
  autoMaskCornersForImage: (
    imageId: string,
    objectUrl: string,
    width: number,
    height: number,
    tolerance?: number,
    onProgress?: unknown,
  ) => autoMaskMock(imageId, objectUrl, width, height, tolerance, onProgress),
}))

const preloadMock = vi.fn(
  async (_onProgress?: unknown) => ({ device: 'wasm' as const }),
)
vi.mock('./lib/mask/bgRemoveSdk', () => ({
  preloadBgRemoveModel: (onProgress?: unknown) => preloadMock(onProgress),
  formatInitProgressLine: (message?: string, ratio?: number) => {
    const pct =
      typeof ratio === 'number' ? ` (${Math.round(ratio * 100)}%)` : ''
    return `Loading model${message ? `: ${message}` : ''}${pct}`
  },
  getBgRemoveTimingSnapshot: () => ({
    initStartedAt: null,
    readyAt: null,
    lastProcessMs: null,
    totalProcessMs: 0,
    processCount: 0,
    lastInitMessage: null,
    lastInitRatio: null,
  }),
}))

function mockCanvasContext() {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    filter: 'none',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
}

function mockImageLoad(width = 40, height = 30) {
  Object.defineProperty(globalThis.Image.prototype, 'src', {
    configurable: true,
    set(this: HTMLImageElement, value: string) {
      this.setAttribute('src', value)
      Object.defineProperty(this, 'naturalWidth', {
        configurable: true,
        value: width,
      })
      Object.defineProperty(this, 'naturalHeight', {
        configurable: true,
        value: height,
      })
      Promise.resolve().then(() => {
        this.onload?.(new Event('load'))
      })
    },
    get(this: HTMLImageElement) {
      return this.getAttribute('src') ?? ''
    },
  })
}

describe('App Phase 1', () => {
  const createObjectURL = vi.fn()
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    cleanup()
    autoMaskMock.mockReset()
    preloadMock.mockReset()
    preloadMock.mockResolvedValue({ device: 'wasm' })
    autoMaskMock.mockResolvedValue({
      confidence: 0.9,
      needsReview: false,
      requestedMethod: 'sdk',
      methodUsed: 'bg-remove-sdk-rmbg1.4',
      genuineModelInference: true,
      device: 'wasm',
    })
    createObjectURL.mockReset()
    revokeObjectURL.mockReset()
    let urlCounter = 0
    createObjectURL.mockImplementation(() => `blob:mock-${++urlCounter}`)
    revokeObjectURL.mockImplementation(() => undefined)
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })
    mockCanvasContext()
    mockImageLoad()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('uploads multiple images, shows thumbnails, and previews on canvas', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByTestId('gallery-empty')).toBeInTheDocument()
    expect(screen.getByTestId('canvas-preview-empty')).toBeInTheDocument()

    const input = screen.getByTestId('image-file-input')
    const fileA = new File([new Uint8Array([1, 2, 3])], 'shirt.png', {
      type: 'image/png',
    })
    const fileB = new File([new Uint8Array([4, 5, 6])], 'jacket.jpg', {
      type: 'image/jpeg',
    })

    await user.upload(input, [fileA, fileB])

    const gallery = await screen.findByTestId('thumbnail-gallery')
    expect(within(gallery).getByText('shirt.png')).toBeInTheDocument()
    expect(within(gallery).getByText('jacket.jpg')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('canvas-preview')).toBeInTheDocument()
    })

    expect(screen.getByTestId('preview-canvas')).toBeInTheDocument()
    expect(screen.getByText(/40\s*×\s*30px/)).toBeInTheDocument()
    expect(createObjectURL).toHaveBeenCalledTimes(2)
  })

  it('shows an error when only non-image files are selected', async () => {
    render(<App />)

    const input = screen.getByTestId('image-file-input') as HTMLInputElement
    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    // Bypass the accept filter so we can exercise client-side validation.
    fireEvent.change(input, { target: { files: [textFile] } })

    expect(await screen.findByTestId('upload-error')).toHaveTextContent(
      'No supported image files were selected.',
    )
    expect(screen.getByTestId('gallery-empty')).toBeInTheDocument()
  })

  it('removes an image and updates selection', async () => {
    const user = userEvent.setup()
    render(<App />)

    const input = screen.getByTestId('image-file-input')
    await user.upload(input, [
      new File([new Uint8Array([1])], 'one.png', { type: 'image/png' }),
      new File([new Uint8Array([2])], 'two.png', { type: 'image/png' }),
    ])

    const gallery = await screen.findByTestId('thumbnail-gallery')
    const removeButtons = within(gallery).getAllByRole('button', {
      name: /Remove /,
    })
    await user.click(removeButtons[0])

    expect(within(gallery).queryByText('one.png')).not.toBeInTheDocument()
    expect(within(gallery).getByText('two.png')).toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalled()
  })

  it('opens the Phase 3 adjust studio for the selected image', async () => {
    const user = userEvent.setup()
    render(<App />)

    const input = screen.getByTestId('image-file-input')
    await user.upload(
      input,
      new File([new Uint8Array([1])], 'shirt.png', { type: 'image/png' }),
    )

    await screen.findByTestId('canvas-preview')
    await user.click(screen.getByTestId('open-adjust-studio'))

    expect(await screen.findByTestId('adjust-studio')).toBeInTheDocument()
    expect(screen.getByTestId('adjust-brightness')).toBeInTheDocument()
    expect(screen.getByTestId('export-download')).toBeInTheDocument()

    await user.click(screen.getByTestId('adjust-back'))
    expect(screen.queryByTestId('adjust-studio')).not.toBeInTheDocument()
    expect(screen.getByTestId('thumbnail-gallery')).toBeInTheDocument()
  })

  it('opens the Phase 2 mask editor for the selected image', async () => {
    const user = userEvent.setup()
    render(<App />)

    const input = screen.getByTestId('image-file-input')
    await user.upload(
      input,
      new File([new Uint8Array([1])], 'shirt.png', { type: 'image/png' }),
    )

    await screen.findByTestId('canvas-preview')
    await user.click(screen.getByTestId('open-mask-editor'))

    expect(await screen.findByTestId('mask-editor')).toBeInTheDocument()
    expect(screen.getByTestId('mask-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('background-panel')).toBeInTheDocument()

    await user.click(screen.getByTestId('mask-back'))
    expect(screen.queryByTestId('mask-editor')).not.toBeInTheDocument()
    expect(screen.getByTestId('thumbnail-gallery')).toBeInTheDocument()
  })

  it('exposes Auto-mask all without a masking-method selector', async () => {
    const user = userEvent.setup()
    render(<App />)

    const input = screen.getByTestId('image-file-input')
    await user.upload(
      input,
      new File([new Uint8Array([1])], 'shirt.png', { type: 'image/png' }),
    )

    await screen.findByTestId('batch-panel')
    expect(screen.getByTestId('batch-auto-mask')).toBeInTheDocument()
    expect(
      screen.queryByTestId('batch-auto-mask-strategy'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/ISNet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Poof/i)).not.toBeInTheDocument()
  })

  it('Auto-mask all uses on-device SDK (no Poof / hosted API)', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    render(<App />)
    const input = screen.getByTestId('image-file-input')
    await user.upload(
      input,
      new File([new Uint8Array([1])], 'shirt.png', { type: 'image/png' }),
    )
    await screen.findByTestId('batch-auto-mask')
    await user.click(screen.getByTestId('batch-auto-mask'))

    await waitFor(() => {
      expect(screen.getByTestId('batch-progress')).toHaveTextContent(
        /bg-remove-sdk-rmbg1\.4/i,
      )
    })
    expect(autoMaskMock).toHaveBeenCalled()
    expect(
      fetchSpy.mock.calls.some((call) =>
        String(call[0]).includes('/api/remove-background'),
      ),
    ).toBe(false)
    expect(
      fetchSpy.mock.calls.some((call) =>
        String(call[0]).includes('api.poof.bg'),
      ),
    ).toBe(false)
    fetchSpy.mockRestore()
  })

  it('surfaces local auto-mask failures without claiming success', async () => {
    const user = userEvent.setup()
    autoMaskMock.mockRejectedValueOnce(new Error('decode failed for fixture'))

    render(<App />)
    await user.upload(
      screen.getByTestId('image-file-input'),
      new File([new Uint8Array([1])], 'shirt.png', { type: 'image/png' }),
    )
    await user.click(await screen.findByTestId('batch-auto-mask'))

    await waitFor(() => {
      expect(screen.getByTestId('batch-progress')).toHaveTextContent(/failed/i)
    })
    expect(screen.getByTestId('upload-error')).toHaveTextContent(
      /decode failed/i,
    )
  })

  it('uploads multiple files without auto-starting inference', async () => {
    const user = userEvent.setup()
    render(<App />)
    const files = Array.from({ length: 8 }, (_, i) =>
      new File([new Uint8Array([i + 1])], `garment-${i + 1}.jpg`, {
        type: 'image/jpeg',
      }),
    )
    await user.upload(screen.getByTestId('image-file-input'), files)

    await screen.findByTestId('batch-panel')
    expect(screen.getByTestId('batch-masked-count')).toHaveTextContent(
      /0.*masked/,
    )
    expect(screen.getByTestId('batch-pending-count')).toHaveTextContent(
      /8.*pending/,
    )
    expect(screen.getByTestId('batch-start-cta')).toBeInTheDocument()
    expect(autoMaskMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('batch-progress')).toHaveTextContent(
      /Tap Auto-mask all/i,
    )
  })

  it('Auto-mask all processes eight pending images exactly once', async () => {
    const user = userEvent.setup()
    const seen = new Set<string>()
    autoMaskMock.mockImplementation(async (imageId: string) => {
      seen.add(imageId)
      return {
        confidence: 0.9,
        needsReview: false,
        requestedMethod: 'sdk',
        methodUsed: 'bg-remove-sdk-rmbg1.4',
        genuineModelInference: true,
        device: 'wasm',
      }
    })

    render(<App />)
    const files = Array.from({ length: 8 }, (_, i) =>
      new File([new Uint8Array([i + 1])], `item-${i + 1}.png`, {
        type: 'image/png',
      }),
    )
    await user.upload(screen.getByTestId('image-file-input'), files)
    await user.click(await screen.findByTestId('batch-auto-mask'))

    await waitFor(() => {
      expect(screen.getByTestId('batch-progress')).toHaveTextContent(
        /Auto-masked 8 images/i,
      )
    })
    expect(autoMaskMock).toHaveBeenCalledTimes(8)
    expect(seen.size).toBe(8)
    expect(screen.getByTestId('batch-masked-count')).toHaveTextContent(
      /8.*masked/,
    )
    expect(screen.queryByTestId('batch-pending-count')).not.toBeInTheDocument()
  })

  it('does not claim manual edits after auto-mask alone', async () => {
    const user = userEvent.setup()
    autoMaskMock.mockResolvedValue({
      confidence: 0.9,
      needsReview: false,
      requestedMethod: 'sdk',
      methodUsed: 'bg-remove-sdk-rmbg1.4',
      genuineModelInference: true,
      device: 'wasm',
    })

    render(<App />)
    await user.upload(
      screen.getByTestId('image-file-input'),
      new File([new Uint8Array([1])], 'auto-only.png', { type: 'image/png' }),
    )
    await user.click(await screen.findByTestId('batch-auto-mask'))
    await waitFor(() => {
      expect(screen.getByTestId('batch-masked-count')).toHaveTextContent(
        /1.*masked/,
      )
    })

    const status = await screen.findByTestId('mask-status')
    expect(status).toHaveTextContent(/bg-remove-sdk-rmbg1\.4/i)
    expect(status).not.toHaveTextContent(/includes manual edits/i)
  })

  it('continues the batch when one image fails', async () => {
    const user = userEvent.setup()
    let call = 0
    autoMaskMock.mockImplementation(async () => {
      call += 1
      if (call === 2) {
        throw new Error('worker OOM on photo-2.jpg')
      }
      return {
        confidence: 0.85,
        needsReview: false,
        requestedMethod: 'sdk',
        methodUsed: 'bg-remove-sdk-rmbg1.4',
        genuineModelInference: true,
        device: 'wasm',
      }
    })

    render(<App />)
    const files = Array.from({ length: 3 }, (_, i) =>
      new File([new Uint8Array([i + 1])], `photo-${i + 1}.jpg`, {
        type: 'image/jpeg',
      }),
    )
    await user.upload(screen.getByTestId('image-file-input'), files)
    await user.click(await screen.findByTestId('batch-auto-mask'))

    await waitFor(() => {
      expect(screen.getByTestId('batch-progress')).toHaveTextContent(
        /2 ok, 1 failed/i,
      )
    })
    expect(autoMaskMock).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('batch-masked-count')).toHaveTextContent(
      /2.*masked/,
    )
    expect(screen.getByTestId('batch-failed-count')).toHaveTextContent(
      /1.*failed/,
    )
    expect(screen.getByTestId('upload-error')).toHaveTextContent(/photo-2/i)
  })

  it('marks the queue failed when the model cannot initialize', async () => {
    const user = userEvent.setup()
    // Upload also kicks a background preload — keep rejections sticky for this test.
    preloadMock.mockRejectedValue(
      new Error('Model init failed (network down).'),
    )

    render(<App />)
    await user.upload(
      screen.getByTestId('image-file-input'),
      [
        new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([2])], 'b.jpg', { type: 'image/jpeg' }),
      ],
    )
    await user.click(await screen.findByTestId('batch-auto-mask'))

    await waitFor(() => {
      expect(screen.getByTestId('batch-progress')).toHaveTextContent(
        /Auto-mask stopped/i,
      )
    })
    expect(autoMaskMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('batch-failed-count')).toHaveTextContent(
      /2.*failed/,
    )
    expect(screen.getByTestId('batch-masked-count')).toHaveTextContent(
      /0.*masked/,
    )
    expect(screen.getByTestId('upload-error')).toHaveTextContent(/Model init/i)
  })

  it('does not overwrite an already-masked image on Auto-mask all', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.upload(
      screen.getByTestId('image-file-input'),
      new File([new Uint8Array([1])], 'one.png', { type: 'image/png' }),
    )
    await user.click(await screen.findByTestId('batch-auto-mask'))
    await waitFor(() => {
      expect(screen.getByTestId('batch-masked-count')).toHaveTextContent(
        /1.*masked/,
      )
    })
    autoMaskMock.mockClear()

    await user.upload(
      screen.getByTestId('image-file-input'),
      new File([new Uint8Array([2])], 'two.png', { type: 'image/png' }),
    )
    await user.click(screen.getByTestId('batch-auto-mask'))
    await waitFor(() => {
      expect(screen.getByTestId('batch-masked-count')).toHaveTextContent(
        /2.*masked/,
      )
    })
    expect(autoMaskMock).toHaveBeenCalledTimes(1)
  })

  it('rejects HEIC with an actionable message when decode fails', async () => {
    const imageFiles = await import('./utils/imageFiles')
    vi.mocked(imageFiles.loadImageDimensions).mockRejectedValueOnce(
      new Error('Failed to load image'),
    )
    render(<App />)
    const input = screen.getByTestId('image-file-input') as HTMLInputElement
    const heic = new File([new Uint8Array([1])], 'iphone.heic', {
      type: 'image/heic',
    })
    // Bypass the accept filter the way a mobile picker can still hand us HEIC.
    fireEvent.change(input, { target: { files: [heic] } })
    expect(await screen.findByTestId('upload-error')).toHaveTextContent(/HEIC/i)
    expect(autoMaskMock).not.toHaveBeenCalled()
  })
})
