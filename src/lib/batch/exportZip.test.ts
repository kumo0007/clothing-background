import { describe, expect, it } from 'vitest'
import { buildExportFilename } from '../export/exportImage'

describe('batch export naming', () => {
  it('builds unique-looking result filenames for zip entries', () => {
    expect(buildExportFilename('01_white_shirt_light_bg.png', 'png')).toBe(
      '01_white_shirt_light_bg-result.png',
    )
    expect(buildExportFilename('shirt.png', 'jpeg')).toBe('shirt-result.jpg')
  })
})
