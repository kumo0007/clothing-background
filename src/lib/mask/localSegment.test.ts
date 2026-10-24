import { describe, expect, it, vi } from 'vitest'
import { segmentImageLocally, LOCAL_SEGMENT_PROVIDER } from './localSegment'
import { createMaskBuffer } from './createMask'
import { MaskHistory } from './maskHistory'
import { paintMaskCircle } from './paintMask'
import { setMask, getMask, clearAllMasks } from './maskStore'

function darkSquareOnCard(): ImageData {
  const w = 40
  const h = 40
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = 230
    data[i * 4 + 1] = 230
    data[i * 4 + 2] = 230
    data[i * 4 + 3] = 255
  }
  for (let y = 10; y < 30; y += 1) {
    for (let x = 10; x < 30; x += 1) {
      const o = (y * w + x) * 4
      data[o] = 25
      data[o + 1] = 25
      data[o + 2] = 30
    }
  }
  return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData
}

describe('segmentImageLocally', () => {
  it('returns a KEEP mask without calling fetch / external APIs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const img = darkSquareOnCard()
    const before = Array.from(img.data)

    const result = await segmentImageLocally(img)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.provider).toBe(LOCAL_SEGMENT_PROVIDER)
    expect(result.genuineModelInference).toBe(false)
    expect(result.methodUsed).toMatch(/opencv-seed|baseline/)
    expect(result.methodUsed).not.toMatch(/isnet|poof|api-/i)
    expect(result.mask.width).toBe(40)
    expect(result.mask.height).toBe(40)
    expect(result.mask.data.some((v) => v >= 128)).toBe(true)
    expect(Array.from(img.data)).toEqual(before)
    fetchSpy.mockRestore()
  })

  it('rejects invalid dimensions', async () => {
    await expect(
      segmentImageLocally({
        width: 0,
        height: 0,
        data: new Uint8ClampedArray(0),
        colorSpace: 'srgb',
      } as ImageData),
    ).rejects.toThrow(/dimensions/)
  })

  it('supports brush edit + undo after local mask commit', () => {
    clearAllMasks()
    const mask = createMaskBuffer(20, 20, 0)
    mask.data.fill(200)
    setMask('local-1', mask)
    const history = new MaskHistory()
    const current = getMask('local-1')!
    history.push(current)
    paintMaskCircle(current, 10, 10, 2, 'remove')
    setMask('local-1', current)
    expect(getMask('local-1')!.data[10 * 20 + 10]).toBe(0)
    const restored = history.undo(getMask('local-1')!)
    setMask('local-1', restored!)
    expect(getMask('local-1')!.data[10 * 20 + 10]).toBe(200)
  })
})
