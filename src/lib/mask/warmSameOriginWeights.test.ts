import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BG_REMOVE_Q8_WEIGHT_PATH,
  warmSameOriginQ8Weights,
} from './warmSameOriginWeights'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('warmSameOriginQ8Weights', () => {
  it('streams bytes and reports progress', async () => {
    const chunk = new Uint8Array([1, 2, 3, 4])
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.close()
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-length': '8' },
        }),
      ),
    )
    const ratios: number[] = []
    const ok = await warmSameOriginQ8Weights((p) => ratios.push(p.ratio))
    expect(ok).toBe(true)
    expect(ratios.at(-1)).toBe(1)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining(BG_REMOVE_Q8_WEIGHT_PATH),
      expect.objectContaining({ cache: 'default' }),
    )
  })

  it('throws on HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    )
    await expect(warmSameOriginQ8Weights()).rejects.toThrow(/HTTP 404/i)
  })
})
