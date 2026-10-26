import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_FILE_ACCEPT } from '../utils/imageFiles'
import { ImageUploader } from './ImageUploader'

afterEach(() => cleanup())

describe('ImageUploader', () => {
  it('uses an iOS-friendly accept list including image/* and HEIC', () => {
    render(<ImageUploader onFilesSelected={() => undefined} />)
    const input = screen.getByTestId('image-file-input') as HTMLInputElement
    expect(input.accept).toBe(IMAGE_FILE_ACCEPT)
    expect(input.accept).toMatch(/image\/\*/)
    expect(input.accept).toMatch(/heic/i)
  })

  it('keeps a visible Choose photos affordance and a full-bleed file input', () => {
    render(<ImageUploader onFilesSelected={() => undefined} />)
    expect(screen.getByTestId('image-upload-choose')).toHaveTextContent(
      /Choose photos/i,
    )
    const input = screen.getByTestId('image-file-input') as HTMLInputElement
    expect(input.getAttribute('aria-label') ?? '').toMatch(/Choose photos/i)
    // Must not be the clipped 1×1 pattern — iOS blocks activation on those.
    expect(input.className).toContain('uploader__input')
  })

  it('forwards selected files from the input change event', () => {
    const onFilesSelected = vi.fn()
    render(<ImageUploader onFilesSelected={onFilesSelected} />)
    const input = screen.getByTestId('image-file-input')
    const file = new File([new Uint8Array([1])], 'shirt.jpg', {
      type: 'image/jpeg',
    })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFilesSelected).toHaveBeenCalledWith([file])
  })

  it('does not nest a button that would steal the iOS tap from the file input', () => {
    render(<ImageUploader onFilesSelected={() => undefined} />)
    const choose = screen.getByTestId('image-upload-choose')
    expect(choose.tagName).not.toBe('BUTTON')
    expect(
      screen.queryByRole('button', { name: /Choose photos/i }),
    ).not.toBeInTheDocument()
  })
})
