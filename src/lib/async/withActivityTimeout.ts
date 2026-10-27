/**
 * Reject when there is no activity for `idleMs`, or when `maxMs` elapses.
 * Call `bump()` on download/init progress so slow-but-alive transfers survive
 * (Safari mobile often needs >3 minutes for the ~44MB RMBG q8 weights).
 */
export type ActivityTimeoutControls = {
  bump: () => void
}

export function withActivityTimeout<T>(
  promise: Promise<T>,
  options: {
    idleMs: number
    maxMs: number
    message: string
    onCreate?: (controls: ActivityTimeoutControls) => void
  },
): Promise<T> {
  const idleMs = Math.max(1, options.idleMs)
  const maxMs = Math.max(idleMs, options.maxMs)

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const startedAt = Date.now()
    let idleTimer: ReturnType<typeof setTimeout> | undefined

    const settleReject = (err: unknown) => {
      if (settled) return
      settled = true
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      reject(err)
    }

    const settleResolve = (value: T) => {
      if (settled) return
      settled = true
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      resolve(value)
    }

    const armIdle = () => {
      if (settled) return
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      const elapsed = Date.now() - startedAt
      const remainingMax = maxMs - elapsed
      if (remainingMax <= 0) {
        settleReject(new Error(options.message))
        return
      }
      idleTimer = setTimeout(
        () => settleReject(new Error(options.message)),
        Math.min(idleMs, remainingMax),
      )
    }

    const bump = () => {
      if (settled) return
      armIdle()
    }

    options.onCreate?.({ bump })
    armIdle()

    promise.then(settleResolve, settleReject)
  })
}
