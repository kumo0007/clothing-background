import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMaskBuffer } from '../mask/createMask'
import { createDefaultBackground } from '../../types/background'
import { renderComposite } from './renderComposite'

describe('renderComposite compositing path', () => {
  const ops: string[] = []
  const putImageData = vi.fn()
  const drawImage = vi.fn()
  const clearRect = vi.fn()
  const fillRect = vi.fn()

  beforeEach(() => {
    ops.length = 0
    putImageData.mockReset()
    drawImage.mockReset()
    clearRect.mockReset()
    fillRect.mockReset()

    HTMLCanvasElement.prototype.getContext = vi.fn(() => {
      let op = 'source-over'
      return {
        drawImage,
        putImageData,
        clearRect,
        fillRect,
        get globalCompositeOperation() {
          return op
        },
        set globalCompositeOperation(value: string) {
          op = value
          ops.push(value)
        },
      }
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext
  })

  it('clips the garment with drawImage after writing the mask via putImageData', () => {
    const target = document.createElement('canvas')
    const original = document.createElement('canvas')
    original.width = 4
    original.height = 4

    const mask = createMaskBuffer(4, 4, 0)
    mask.data[0] = 255

    renderComposite(
      target,
      original,
      mask,
      { ...createDefaultBackground(), type: 'color', color: '#00ff00' },
      null,
    )

    // Mask alpha must be materialized with putImageData on a helper canvas.
    expect(putImageData).toHaveBeenCalled()
    // Clipping must use drawImage (putImageData ignores composite ops).
    expect(drawImage).toHaveBeenCalled()
    expect(ops).toContain('destination-in')
  })
})
