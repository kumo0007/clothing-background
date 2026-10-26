import { describe, expect, it } from 'vitest'
import {
  filterImageFiles,
  IMAGE_FILE_ACCEPT,
  isAcceptedImageFile,
  isHeicLikeFile,
} from './imageFiles'

describe('IMAGE_FILE_ACCEPT', () => {
  it('includes image/* and HEIC so iPhone Photos can hand files to JS', () => {
    expect(IMAGE_FILE_ACCEPT).toMatch(/image\/\*/)
    expect(IMAGE_FILE_ACCEPT).toMatch(/\.heic/i)
    expect(IMAGE_FILE_ACCEPT).toMatch(/image\/heic/i)
  })
})

describe('isAcceptedImageFile', () => {
  it('accepts common image MIME types', () => {
    expect(isAcceptedImageFile(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe(
      true,
    )
    expect(isAcceptedImageFile(new File([], 'a.png', { type: 'image/png' }))).toBe(
      true,
    )
    expect(
      isAcceptedImageFile(new File([], 'a.webp', { type: 'image/webp' })),
    ).toBe(true)
  })

  it('accepts iOS JPEG aliases', () => {
    expect(isAcceptedImageFile(new File([], 'a.jpg', { type: 'image/jpg' }))).toBe(
      true,
    )
    expect(
      isAcceptedImageFile(new File([], 'a.jpg', { type: 'image/pjpeg' })),
    ).toBe(true)
  })

  it('rejects non-image files', () => {
    expect(
      isAcceptedImageFile(new File([], 'notes.txt', { type: 'text/plain' })),
    ).toBe(false)
  })

  it('falls back to file extension when MIME is empty', () => {
    expect(isAcceptedImageFile(new File([], 'shirt.PNG', { type: '' }))).toBe(
      true,
    )
    expect(isAcceptedImageFile(new File([], 'readme.md', { type: '' }))).toBe(
      false,
    )
  })

  it('detects HEIC-like files for decode attempt / guidance', () => {
    expect(
      isHeicLikeFile(new File([], 'IMG_0001.HEIC', { type: 'image/heic' })),
    ).toBe(true)
    expect(isHeicLikeFile(new File([], 'IMG_0001.HEIC', { type: '' }))).toBe(
      true,
    )
  })
})

describe('filterImageFiles', () => {
  it('keeps only image files from a mixed list', () => {
    const files = [
      new File([], 'a.png', { type: 'image/png' }),
      new File([], 'b.txt', { type: 'text/plain' }),
      new File([], 'c.jpg', { type: 'image/jpeg' }),
    ]
    const result = filterImageFiles(files)
    expect(result).toHaveLength(2)
    expect(result.map((file) => file.name)).toEqual(['a.png', 'c.jpg'])
  })
})
