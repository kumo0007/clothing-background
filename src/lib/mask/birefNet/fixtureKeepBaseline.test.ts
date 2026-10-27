import { describe, expect, it } from 'vitest'
import { BIREFNET_FIXTURE_KEEP_BASELINE } from './fixtureKeepBaseline'

/** Independent-verify / production-readiness locked KEEP%. */
const INDEPENDENT_VERIFY_KEEP: Record<string, number> = {
  'dark-hoodie': 55.43,
  'white-tshirt': 49.04,
  'white-sneakers': 34.5,
  'open-handbag': 35.68,
  'polo-carpet-closeup': 73.89,
}

describe('BIREFNET_FIXTURE_KEEP_BASELINE', () => {
  it('locks the five-fixture KEEP% from independent verification', () => {
    const ids = Object.keys(BIREFNET_FIXTURE_KEEP_BASELINE)
    expect(ids).toEqual(Object.keys(INDEPENDENT_VERIFY_KEEP))
    for (const id of ids) {
      expect(BIREFNET_FIXTURE_KEEP_BASELINE[id as keyof typeof BIREFNET_FIXTURE_KEEP_BASELINE].keepPct).toBe(
        INDEPENDENT_VERIFY_KEEP[id],
      )
    }
  })

  it('pins a 64-hex SHA-256 for each fixture mask', () => {
    for (const row of Object.values(BIREFNET_FIXTURE_KEEP_BASELINE)) {
      expect(row.maskSha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })
})
