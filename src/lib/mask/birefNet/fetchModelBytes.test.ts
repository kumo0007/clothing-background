import { afterEach, describe, expect, it, vi } from 'vitest'
import { BIREFNET_ONNX_FP16_BYTES } from './constants'
import {
  fetchBirefNetModelBytes,
  setFetchBirefNetModelBytesForTests,
} from './session'

afterEach(() => {
  setFetchBirefNetModelBytesForTests(null)
  vi.unstubAllGlobals()
})

describe('fetchBirefNetModelBytes', () => {
  it('rejects when body length does not match expected fp16 size', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-length' ? '12' : null,
        },
        arrayBuffer: async () => new ArrayBuffer(12),
      })),
    )

    await expect(
      fetchBirefNetModelBytes('/models/fake.onnx', BIREFNET_ONNX_FP16_BYTES),
    ).rejects.toThrow(/Content-Length is 12/)
  })

  it('returns bytes when length matches', async () => {
    const body = new Uint8Array(2_000_000)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-length'
              ? String(body.byteLength)
              : null,
        },
        arrayBuffer: async () => body.buffer,
      })),
    )

    const got = await fetchBirefNetModelBytes('/models/fake.onnx', undefined)
    expect(got.byteLength).toBe(2_000_000)
  })

  it('test override bypasses network', async () => {
    setFetchBirefNetModelBytesForTests(async () => new Uint8Array([1, 2, 3]))
    const got = await fetchBirefNetModelBytes('/ignored', 99)
    expect(Array.from(got)).toEqual([1, 2, 3])
  })
})
