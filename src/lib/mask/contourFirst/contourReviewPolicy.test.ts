import { describe, expect, it } from 'vitest'
import {
  decideContourNeedsReview,
  type ContourValidationReport,
} from './contourFirstSegment'

function baseValidation(
  overrides: Partial<ContourValidationReport> = {},
): ContourValidationReport {
  return {
    decision: 'accept',
    reason: 'accepted',
    areaRatio: 0.3,
    exteriorRatio: 0.55,
    gapAddedRatio: 0.02,
    substantialGapCompletion: true,
    seedAgreement: 0.73,
    reliableFgAgreement: 0.77,
    reliableFgRatio: 0.38,
    reliableBgContamination: 0,
    borderTouchRatio: 0,
    boundarySupport: 0.93,
    componentCount: 2,
    largestComponentRatio: 0.99,
    internalHoleRatio: 0.1,
    bounds: null,
    ...overrides,
  }
}

describe('decideContourNeedsReview', () => {
  it('always reviews rejected contour fallbacks', () => {
    const r = decideContourNeedsReview({
      contourAccepted: false,
      confidenceNeedsReview: false,
      confidenceReasons: [],
      substantialCompletion: false,
      borderTouchRatio: 0,
      validation: null,
    })
    expect(r.needsReview).toBe(true)
    expect(r.reasons).toContain('contour-rejected-fallback-seed')
  })

  it('does not flag jeans-like accepted contour for modest substantial gap alone', () => {
    const r = decideContourNeedsReview({
      contourAccepted: true,
      confidenceNeedsReview: false,
      confidenceReasons: [],
      substantialCompletion: true,
      borderTouchRatio: 0,
      validation: baseValidation({ gapAddedRatio: 0.0195 }),
    })
    expect(r.needsReview).toBe(false)
    expect(r.reasons).toEqual([])
  })

  it('flags substantial gap when agreement is marginal', () => {
    const r = decideContourNeedsReview({
      contourAccepted: true,
      confidenceNeedsReview: false,
      confidenceReasons: [],
      substantialCompletion: true,
      borderTouchRatio: 0,
      validation: baseValidation({
        seedAgreement: 0.55,
        reliableFgAgreement: 0.5,
        boundarySupport: 0.5,
        largestComponentRatio: 0.7,
        gapAddedRatio: 0.02,
      }),
    })
    expect(r.needsReview).toBe(true)
    expect(r.reasons.some((x) => x.includes('substantial-gap'))).toBe(true)
  })

  it('flags low-confidence accepted results', () => {
    const r = decideContourNeedsReview({
      contourAccepted: true,
      confidenceNeedsReview: true,
      confidenceReasons: ['high near-card pale KEEP share (white-on-white risk)'],
      substantialCompletion: false,
      borderTouchRatio: 0,
      validation: baseValidation({ substantialGapCompletion: false }),
    })
    expect(r.needsReview).toBe(true)
    expect(r.reasons[0]).toMatch(/white-on-white/)
  })

  it('accepted high-confidence dark contour without gap stays clear', () => {
    const r = decideContourNeedsReview({
      contourAccepted: true,
      confidenceNeedsReview: false,
      confidenceReasons: [],
      substantialCompletion: false,
      borderTouchRatio: 0,
      validation: baseValidation({
        substantialGapCompletion: false,
        gapAddedRatio: 0.002,
      }),
    })
    expect(r.needsReview).toBe(false)
  })
})
