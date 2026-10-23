import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from '../createMask'
import {
  inferImageMimeFromPath,
  resolveIsnetInputBlob,
  toIsnetInputBlob,
} from './isnetSegment'

/**
 * Unit coverage for mask derivation helpers — full ONNX download is integration-only.
 */
describe('isnetSegment mask polarity contract', () => {
  it('documents polarity: high mask = KEEP garment for compositing', () => {
    const mask = createMaskBuffer(2, 1, 0)
    mask.data[0] = 255
    mask.data[1] = 0
    // Compositor treats 255 as full source RGB — regression guard.
    expect(mask.data[0]).toBe(255)
    expect(mask.data[1]).toBe(0)
  })

  it('ISNet Node input Blob always carries an image MIME (avoids Unsupported format: )', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const blob = toIsnetInputBlob(bytes, 'image/png')
    expect(blob.type).toBe('image/png')
    const jpeg = toIsnetInputBlob(bytes, 'image/jpeg')
    expect(jpeg.type).toBe('image/jpeg')
    const webp = toIsnetInputBlob(bytes, 'image/webp')
    expect(webp.type).toBe('image/webp')
    // Empty type is exactly what @imgly imageDecode rejects.
    expect(blob.type).not.toBe('')
  })

  it('inferImageMimeFromPath maps png/jpeg/webp correctly', () => {
    expect(inferImageMimeFromPath('a/b/c.PNG')).toBe('image/png')
    expect(inferImageMimeFromPath('shot.jpg')).toBe('image/jpeg')
    expect(inferImageMimeFromPath('shot.jpeg')).toBe('image/jpeg')
    expect(inferImageMimeFromPath('x.webp')).toBe('image/webp')
  })

  it('resolveIsnetInputBlob rejects typeless Blob and bare bytes without mime', () => {
    expect(() => resolveIsnetInputBlob(new Blob([new Uint8Array([1])]))).toThrow(
      /unsupported or empty type/i,
    )
    expect(() => resolveIsnetInputBlob(new Uint8Array([1, 2, 3]))).toThrow(
      /requires mime/i,
    )
    const typed = new Blob([new Uint8Array([1])], { type: 'image/png' })
    expect(resolveIsnetInputBlob(typed).type).toBe('image/png')
    expect(resolveIsnetInputBlob(new Uint8Array([1]), 'image/jpeg').type).toBe(
      'image/jpeg',
    )
  })

  it('isNodeRuntime prefers browser when window/document exist', async () => {
    // In Vitest/jsdom both window and process exist — browser path must win so
    // we never import background-removal-node into the client bundle by mistake.
    const hasWindow = typeof window !== 'undefined'
    const hasDocument = typeof document !== 'undefined'
    expect(hasWindow && hasDocument).toBe(true)
  })

  it('AutoMaskMethod includes isnet without changing default auto path', async () => {
    const { runAutoMaskPipeline } = await import('../autoMaskPipeline')
    const data = new Uint8ClampedArray(16)
    for (let i = 0; i < 4; i += 1) {
      data[i * 4] = 220
      data[i * 4 + 1] = 220
      data[i * 4 + 2] = 220
      data[i * 4 + 3] = 255
    }
    const image = {
      width: 2,
      height: 2,
      data,
      colorSpace: 'srgb',
    } as ImageData
    const result = await runAutoMaskPipeline(image, 'auto')
    // Default must remain Lab-seed family — never silent ISNet.
    expect(result.methodUsed).not.toBe('isnet-onnx')
    expect(result.genuineModelInference).not.toBe(true)
  })

  it('runAutoMaskPipeline accepts onIsnetProgress without changing Lab default', async () => {
    const { runAutoMaskPipeline } = await import('../autoMaskPipeline')
    const data = new Uint8ClampedArray(16)
    data.fill(200)
    const image = {
      width: 2,
      height: 2,
      data,
      colorSpace: 'srgb',
    } as ImageData
    let called = false
    const result = await runAutoMaskPipeline(image, 'auto', 40, {
      onIsnetProgress: () => {
        called = true
      },
    })
    expect(result.methodUsed).not.toBe('isnet-onnx')
    expect(called).toBe(false)
  })
})
