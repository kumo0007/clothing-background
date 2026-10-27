import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from './createMask'
import { isUsableKeepMask, maskKeepRatio } from './maskKeepRatio'

describe('maskKeepRatio', () => {
  it('returns 0 for an empty KEEP mask', () => {
    const mask = createMaskBuffer(10, 10, 0)
    expect(maskKeepRatio(mask)).toBe(0)
    expect(isUsableKeepMask(mask)).toBe(false)
  })

  it('detects a usable subject region', () => {
    const mask = createMaskBuffer(10, 10, 0)
    for (let i = 0; i < 20; i += 1) mask.data[i] = 255
    expect(maskKeepRatio(mask)).toBeCloseTo(0.2)
    expect(isUsableKeepMask(mask)).toBe(true)
  })
})
