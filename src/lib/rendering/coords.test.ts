import { describe, expect, it } from 'vitest'
import { screenToImage, zoomAtPoint, clampScale } from './coords'

describe('coords', () => {
  it('converts screen points into image space', () => {
    const point = screenToImage(120, 80, { scale: 2, offsetX: 20, offsetY: 10 })
    expect(point).toEqual({ x: 50, y: 35 })
  })

  it('keeps the focal image point stable when zooming', () => {
    const before = { scale: 1, offsetX: 0, offsetY: 0 }
    const after = zoomAtPoint(before, 100, 50, 2)
    const imagePoint = screenToImage(100, 50, before)
    const still = screenToImage(100, 50, after)
    expect(still.x).toBeCloseTo(imagePoint.x)
    expect(still.y).toBeCloseTo(imagePoint.y)
  })

  it('supports successive zoom updates from a synchronously updated transform', () => {
    let transform = { scale: 1, offsetX: 0, offsetY: 0 }
    for (const next of [1.5, 2, 4]) {
      transform = zoomAtPoint(transform, 50, 50, next)
    }
    expect(clampScale(transform.scale)).toBe(4)
  })

  it('maps through pan + scale without cumulative drift at a fixed screen point', () => {
    let transform = { scale: 0.5, offsetX: 12.5, offsetY: -3 }
    const screenX = 88
    const screenY = 44
    const baseline = screenToImage(screenX, screenY, transform)
    for (const scale of [0.75, 1.25, 2, 3.5, 1]) {
      transform = zoomAtPoint(transform, screenX, screenY, scale)
      const again = screenToImage(screenX, screenY, transform)
      expect(again.x).toBeCloseTo(baseline.x, 10)
      expect(again.y).toBeCloseTo(baseline.y, 10)
    }
  })
})
