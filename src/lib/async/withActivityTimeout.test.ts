import { afterEach, describe, expect, it, vi } from 'vitest'
import { withActivityTimeout } from './withActivityTimeout'

describe('withActivityTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves when the promise finishes before idle expiry', async () => {
    await expect(
      withActivityTimeout(Promise.resolve('ok'), {
        idleMs: 1_000,
        maxMs: 5_000,
        message: 'stalled',
      }),
    ).resolves.toBe('ok')
  })

  it('rejects after idle with no bumps', async () => {
    vi.useFakeTimers()
    const hung = new Promise<number>(() => undefined)
    const pending = withActivityTimeout(hung, {
      idleMs: 3_000,
      maxMs: 60_000,
      message: 'stalled download',
    })
    const assertion = expect(pending).rejects.toThrow(/stalled download/i)
    await vi.advanceTimersByTimeAsync(3_000)
    await assertion
  })

  it('extends lifetime when bump() is called during download progress', async () => {
    vi.useFakeTimers()
    let bump: () => void = () => {}
    const hung = new Promise<number>(() => undefined)
    const pending = withActivityTimeout(hung, {
      idleMs: 5_000,
      maxMs: 30_000,
      message: 'stalled download',
      onCreate: (controls) => {
        bump = controls.bump
      },
    })

    await vi.advanceTimersByTimeAsync(4_000)
    bump()
    await vi.advanceTimersByTimeAsync(4_000)
    bump()

    let rejected = false
    void pending.then(
      () => undefined,
      () => {
        rejected = true
      },
    )
    await vi.advanceTimersByTimeAsync(1_000)
    expect(rejected).toBe(false)

    await vi.advanceTimersByTimeAsync(5_000)
    await expect(pending).rejects.toThrow(/stalled download/i)
  })
})
