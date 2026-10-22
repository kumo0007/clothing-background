import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from './createMask'
import { invertMaskBuffer } from './invertMask'
import { MaskHistory } from './maskHistory'
import { paintMaskCircle } from './paintMask'
import { fillPolygonOnMask } from './polygonMask'

describe('mask operations', () => {
  it('starts all black (nothing preserved)', () => {
    const mask = createMaskBuffer(4, 4, 0)
    expect(mask.data.every((value) => value === 0)).toBe(true)
  })

  it('paints KEEP as white and REMOVE as black', () => {
    const mask = createMaskBuffer(20, 20, 0)
    paintMaskCircle(mask, 10, 10, 3, 'keep')
    expect(mask.data[10 * 20 + 10]).toBe(255)

    paintMaskCircle(mask, 10, 10, 3, 'remove')
    expect(mask.data[10 * 20 + 10]).toBe(0)
  })

  it('keeps brush strokes binary (no gray halo values)', () => {
    const mask = createMaskBuffer(40, 40, 0)
    paintMaskCircle(mask, 20, 20, 8, 'keep')
    for (const value of mask.data) {
      expect(value === 0 || value === 255).toBe(true)
    }
  })

  it('inverts mask values', () => {
    const mask = createMaskBuffer(2, 1, 0)
    mask.data[0] = 255
    mask.data[1] = 40
    invertMaskBuffer(mask)
    expect(Array.from(mask.data)).toEqual([0, 215])
  })

  it('fills a polygon onto the mask', () => {
    const mask = createMaskBuffer(10, 10, 0)
    fillPolygonOnMask(
      mask,
      [
        { x: 1, y: 1 },
        { x: 8, y: 1 },
        { x: 8, y: 8 },
        { x: 1, y: 8 },
      ],
      'keep',
    )
    expect(mask.data[4 * 10 + 4]).toBe(255)
    expect(mask.data[0]).toBe(0)
  })

  it('supports undo and redo of mask snapshots', () => {
    const history = new MaskHistory()
    const mask = createMaskBuffer(4, 4, 0)
    history.push(mask)
    paintMaskCircle(mask, 1, 1, 2, 'keep')
    const undone = history.undo(mask)
    expect(undone).not.toBeNull()
    expect(undone!.data.every((value) => value === 0)).toBe(true)
    const redone = history.redo(undone!)
    expect(redone).not.toBeNull()
    expect(redone!.data.some((value) => value > 0)).toBe(true)
  })
})
