import { describe, expect, it } from 'vitest'
import { createMaskBuffer, cloneMaskBuffer } from '../createMask'
import { MaskHistory } from '../maskHistory'
import { runMaskDiagnostics } from './runMaskDiagnostics'
import {
  previewBorderStudioPeel,
  applyBorderStudioPeel,
} from './borderStudioRepair'
import { clearAllMasks, getMask, setMask } from '../maskStore'

function makeImage(
  w: number,
  h: number,
  fill: [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = fill[0]
    data[i * 4 + 1] = fill[1]
    data[i * 4 + 2] = fill[2]
    data[i * 4 + 3] = 255
  }
  return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData
}

function setRgb(
  image: ImageData,
  x: number,
  y: number,
  rgb: [number, number, number],
) {
  const o = (y * image.width + x) * 4
  image.data[o] = rgb[0]
  image.data[o + 1] = rgb[1]
  image.data[o + 2] = rgb[2]
}

describe('review lifecycle integrity', () => {
  it('diagnostics never mutate mask; peel preview never mutates; apply+undo restores bytes', () => {
    clearAllMasks()
    const w = 64
    const h = 64
    const img = makeImage(w, h, [245, 245, 245])
    const mask = createMaskBuffer(w, h, 0)
    // Border studio KEEP + dark garment
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (y < 5 || x < 5 || y > h - 6 || x > w - 6) {
          mask.data[y * w + x] = 255
        }
        if (y > 15 && y < 50 && x > 15 && x < 50) {
          setRgb(img, x, y, [30, 30, 35])
          mask.data[y * w + x] = 255
        }
      }
    }
    setMask('life-1', mask)
    const beforeDiag = Array.from(getMask('life-1')!.data)
    runMaskDiagnostics({
      mask: getMask('life-1')!,
      imageData: img,
      profile: 'neural',
      method: 'bg-remove-sdk-rmbg1.4',
      maskRevision: 1,
    })
    expect(Array.from(getMask('life-1')!.data)).toEqual(beforeDiag)

    const preview = previewBorderStudioPeel(getMask('life-1')!, img)
    expect(Array.from(getMask('life-1')!.data)).toEqual(beforeDiag)

    if (preview.recommendApply) {
      const history = new MaskHistory()
      const current = getMask('life-1')!
      history.push(cloneMaskBuffer(current))
      applyBorderStudioPeel(current, preview.candidate)
      const afterApply = Array.from(current.data)
      expect(afterApply).not.toEqual(beforeDiag)
      const restored = history.undo(current)!
      current.data.set(restored.data)
      expect(Array.from(current.data)).toEqual(beforeDiag)
    }
  })

  it('manual KEEP paint is preserved across diagnostics', () => {
    clearAllMasks()
    const mask = createMaskBuffer(32, 32, 0)
    mask.data[16 * 32 + 16] = 255
    setMask('edit-life', mask)
    const img = makeImage(32, 32, [240, 240, 240])
    runMaskDiagnostics({
      mask: getMask('edit-life')!,
      imageData: img,
      profile: 'neural',
      hasManualEdits: true,
      maskRevision: 3,
    })
    expect(getMask('edit-life')!.data[16 * 32 + 16]).toBe(255)
  })
})
