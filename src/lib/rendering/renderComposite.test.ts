import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from '../mask/createMask'

describe('mask buffers for compositing', () => {
  it('keeps white for garment and black for background regions', () => {
    const mask = createMaskBuffer(2, 1, 0)
    mask.data[0] = 255
    mask.data[1] = 0
    expect(mask.data[0]).toBe(255)
    expect(mask.data[1]).toBe(0)
  })
})
