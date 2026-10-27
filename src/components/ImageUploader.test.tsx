import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_FILE_ACCEPT } from '../utils/imageFiles'
import { ImageUploader } from './ImageUploader'

afterEach(() => {
  cleanup()
})

describe('ImageUploader', () => {
  it('exposes a visible native file input (required for iOS Safari picker)', () => {
    render(<ImageUploader onFilesSelected={() => undefined} />)
    const input = screen.getByTestId('image-file-input') as HTMLInputElement
    expect(input.type).toBe('file')
    expect(input.accept).toBe(IMAGE_FILE_ACCEPT)
    expect(IMAGE_FILE_ACCEPT).toBe('image/*')
    expect(input.className).toContain('uploader__file')
    expect(input).toBeVisible()
  })

  it('does not render the IDE Simple Browser warning banner', () => {
    render(<ImageUploader onFilesSelected={() => undefined} />)
    expect(screen.queryByTestId('upload-env-warning')).toBeNull()
    expect(screen.queryByText(/Cursor preview cannot open/i)).toBeNull()
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

  it('accepts drag-and-drop uploads', () => {
    const onFilesSelected = vi.fn()
    render(<ImageUploader onFilesSelected={onFilesSelected} />)
    const file = new File([new Uint8Array([1])], 'coat.jpg', {
      type: 'image/jpeg',
    })
    fireEvent.drop(screen.getByTestId('image-uploader'), {
      dataTransfer: { files: [file] },
    })
    expect(onFilesSelected).toHaveBeenCalledWith([file])
  })

  it('shows a note when the picker returns no files', () => {
    render(<ImageUploader onFilesSelected={() => undefined} />)
    fireEvent.change(screen.getByTestId('image-file-input'), {
      target: { files: [] },
    })
    expect(screen.getByTestId('upload-picker-note')).toHaveTextContent(
      /No photos came back/i,
    )
  })
})
