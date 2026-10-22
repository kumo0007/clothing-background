import { describe, expect, it } from 'vitest'
import { buildExportFilename } from './exportImage'

describe('buildExportFilename', () => {
  it('replaces the extension for png and jpeg exports', () => {
    expect(buildExportFilename('shirt photo.png', 'png')).toBe(
      'shirt_photo-result.png',
    )
    expect(buildExportFilename('jacket.JPEG', 'jpeg')).toBe('jacket-result.jpg')
  })
})
