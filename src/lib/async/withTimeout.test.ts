import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from './withTimeout'

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves when the promise wins the race', async () => {
    await expect(withTimeout(Promise.resolve(7), 1_000, 'too slow')).resolves.toBe(
      7,
    )
  })

  it('rejects on timeout and never treats hang as success', async () => {
    vi.useFakeTimers()
    const hung = new Promise<number>(() => undefined)
    const pending = withTimeout(hung, 5_000, 'operation timed out')
    const assertion = expect(pending).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
  })
})
