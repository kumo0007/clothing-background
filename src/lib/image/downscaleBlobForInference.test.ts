import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_INFERENCE_MAX_EDGE,
  MOBILE_INFERENCE_MAX_EDGE,
  downscaleBlobForInference,
  inferenceMaxEdgeForDevice,
} from './downscaleBlobForInference'

vi.mock('./loadHtmlImage', () => ({
  loadHtmlImage: vi.fn(async () => {
    const img = {
      naturalWidth: 4000,
      naturalHeight: 3000,
    }
    return img as HTMLImageElement
  }),
}))

describe('downscaleBlobForInference', () => {
  it('picks a tighter long-edge cap on mobile', () => {
    expect(inferenceMaxEdgeForDevice(true)).toBe(MOBILE_INFERENCE_MAX_EDGE)
    expect(inferenceMaxEdgeForDevice(false)).toBe(DESKTOP_INFERENCE_MAX_EDGE)
  })

  it('returns the original blob when already under the cap', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
    const result = await downscaleBlobForInference(blob, 800, 600, {
      maxEdge: 1600,
    })
    expect(result.scaled).toBe(false)
    expect(result.blob).toBe(blob)
    expect(result.width).toBe(800)
  })

  it('scales large photos down for inference', async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
    ) {
      cb(new Blob([new Uint8Array([9, 9, 9])], { type: 'image/jpeg' }))
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob

    const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' })
    const result = await downscaleBlobForInference(blob, 4000, 3000, {
      maxEdge: 1600,
    })
    expect(result.scaled).toBe(true)
    expect(result.width).toBe(1600)
    expect(result.height).toBe(1200)
    expect(result.blob).not.toBe(blob)
  })
})
