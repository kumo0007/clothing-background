import { describe, expect, it } from 'vitest'
import {
  filterImageFiles,
  IMAGE_FILE_ACCEPT,
  isAcceptedImageFile,
  isHeicLikeFile,
  materializePickedFile,
  sniffImageMime,
} from './imageFiles'

describe('IMAGE_FILE_ACCEPT', () => {
  it('is only image/* so iPhone Safari opens the Photos sheet', () => {
    expect(IMAGE_FILE_ACCEPT).toBe('image/*')
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

  it('accepts iOS Photo Library stubs with empty type and no extension', () => {
    expect(
      isAcceptedImageFile(new File([new Uint8Array([1, 2, 3])], '', { type: '' })),
    ).toBe(true)
    expect(
      isAcceptedImageFile(
        new File([new Uint8Array([1, 2, 3])], 'image', { type: '' }),
      ),
    ).toBe(true)
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

describe('sniffImageMime', () => {
  it('detects JPEG magic bytes', () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer)).toBe(
      'image/jpeg',
    )
  })
})

describe('materializePickedFile', () => {
  it('copies bytes into a heap File with a stable name and sniffed type', async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    const pathBacked = new File([jpegBytes], '', { type: '' })
    const materialized = await materializePickedFile(pathBacked, 0)
    expect(materialized.name).toBe('photo-1.jpg')
    expect(materialized.type).toBe('image/jpeg')
    expect(new Uint8Array(await materialized.arrayBuffer())).toEqual(jpegBytes)
  })

  it('rejects empty gallery payloads', async () => {
    await expect(
      materializePickedFile(new File([], 'empty.jpg', { type: 'image/jpeg' })),
    ).rejects.toThrow(/0 bytes/i)
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
