import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('Choose photos opens the file picker via input.click()', async () => {
    const user = userEvent.setup()
    render(<ImageUploader onFilesSelected={() => undefined} />)
    const input = screen.getByTestId('image-file-input') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')
    await user.click(screen.getByTestId('image-upload-choose'))
    expect(clickSpy).toHaveBeenCalled()
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
})
