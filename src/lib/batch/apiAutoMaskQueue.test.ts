import { describe, expect, it } from 'vitest'
import type { MaskStateMeta } from '../../types/mask'

/**
 * Mirrors App.runApiAutoMask('failed') selection: only autoFailed images.
 * Successful masks are never re-queued.
 */
function selectRetryQueue(
  ids: string[],
  metaById: Record<string, MaskStateMeta | undefined>,
  scope: 'all' | 'failed' | 'selected',
  selectedId: string | null,
): string[] {
  if (scope === 'all') return [...ids]
  if (scope === 'selected') {
    return selectedId && ids.includes(selectedId) ? [selectedId] : []
  }
  return ids.filter((id) => metaById[id]?.autoFailed === true)
}

describe('API auto-mask retry queue', () => {
  it('retry-failed skips successful images', () => {
    const queue = selectRetryQueue(
      ['ok', 'fail-a', 'fail-b'],
      {
        ok: {
          revision: 1,
          hasEdits: true,
          autoMethodUsed: 'opencv-seed-fallback',
          autoFailed: false,
        },
        'fail-a': {
          revision: 0,
          hasEdits: false,
          autoFailed: true,
          needsReview: true,
          reviewReason: 'rate limit',
        },
        'fail-b': {
          revision: 0,
          hasEdits: false,
          autoFailed: true,
          needsReview: true,
          reviewReason: 'missing key',
        },
      },
      'failed',
      null,
    )
    expect(queue).toEqual(['fail-a', 'fail-b'])
    expect(queue).not.toContain('ok')
  })

  it('retry-selected only targets the selection', () => {
    expect(
      selectRetryQueue(
        ['a', 'b'],
        {
          a: { revision: 0, hasEdits: false, autoFailed: true },
          b: { revision: 0, hasEdits: false, autoFailed: true },
        },
        'selected',
        'b',
      ),
    ).toEqual(['b'])
  })
})
