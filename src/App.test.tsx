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
})
