import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_FILE_ACCEPT } from '../utils/imageFiles'
import { ImageUploader } from './ImageUploader'

afterEach(() => cleanup())

describe('ImageUploader', () => {
  it('uses a short iOS-friendly accept list and a native file input', () => {
    render(<ImageUploader onFilesSelected={() => undefined} />)
    const input = screen.getByTestId('image-file-input') as HTMLInputElement
    expect(input.accept).toBe(IMAGE_FILE_ACCEPT)
    expect(input.accept).toMatch(/image\/\*/)
    expect(input.className).toContain('uploader__native-file')
    expect(input.type).toBe('file')
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

  it('mentions the native Choose File control in the hint', () => {
    render(<ImageUploader onFilesSelected={() => undefined} />)
    expect(screen.getByText(/Choose File/i)).toBeInTheDocument()
  })
})
