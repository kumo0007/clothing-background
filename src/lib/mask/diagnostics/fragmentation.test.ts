import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from '../createMask'
import {
  analyzeKeepComponents,
  shouldFlagFragmentation,
} from './fragmentation'

describe('analyzeKeepComponents', () => {
  it('separates main body from noise dust and does not flag dust-only masks', () => {
    const w = 100
    const h = 100
    const mask = createMaskBuffer(w, h, 0)
    // Main body
    for (let y = 20; y < 80; y += 1) {
      for (let x = 25; x < 75; x += 1) {
        mask.data[y * w + x] = 255
      }
    }
    // 200 one-pixel KEEP dust islands (would look like "200 components" naively)
    let dust = 0
    for (let y = 0; y < h && dust < 200; y += 3) {
      for (let x = 0; x < w && dust < 200; x += 3) {
        if (mask.data[y * w + x]! >= 128) continue
        mask.data[y * w + x] = 255
        dust += 1
      }
    }

    const analysis = analyzeKeepComponents(mask)
    expect(analysis.summary.totalComponents).toBeGreaterThan(50)
    expect(analysis.summary.noiseComponents).toBeGreaterThan(50)
    expect(analysis.summary.significantComponents).toBe(1)
    expect(analysis.summary.largestAreaShare).toBeGreaterThan(0.9)

    const flag = shouldFlagFragmentation(analysis.summary, 'neural')
    expect(flag.flag).toBe(false)
    // measuredValue is detached area share, not raw island count
    expect(flag.measuredValue).toBeLessThan(0.05)
    expect(flag.unit).toMatch(/detached_significant_area_share/)
  })

  it('flags when substantial KEEP mass is detached from the main body', () => {
    const w = 80
    const h = 80
    const mask = createMaskBuffer(w, h, 0)
    // Main ~40%
    for (let y = 10; y < 50; y += 1) {
      for (let x = 10; x < 50; x += 1) mask.data[y * w + x] = 255
    }
    // Detached floater ~20%
    for (let y = 55; y < 75; y += 1) {
      for (let x = 55; x < 75; x += 1) mask.data[y * w + x] = 255
    }

    const analysis = analyzeKeepComponents(mask)
    expect(analysis.summary.detachedSignificantAreaShare).toBeGreaterThan(0.12)
    const flag = shouldFlagFragmentation(analysis.summary, 'neural')
    expect(flag.flag).toBe(true)
    expect(flag.measuredValue).not.toBe(analysis.summary.totalComponents)
  })

  it('labelMap paints main vs detached without mutating mask', () => {
    const w = 40
    const h = 40
    const mask = createMaskBuffer(w, h, 0)
    for (let y = 5; y < 25; y += 1) {
      for (let x = 5; x < 25; x += 1) mask.data[y * w + x] = 255
    }
    for (let y = 30; y < 38; y += 1) {
      for (let x = 30; x < 38; x += 1) mask.data[y * w + x] = 255
    }
    const before = Array.from(mask.data)
    const analysis = analyzeKeepComponents(mask)
    expect(Array.from(mask.data)).toEqual(before)
    expect(analysis.labelMap.some((v) => v === 2)).toBe(true)
    expect(analysis.labelMap.some((v) => v === 3)).toBe(true)
  })

  it('noise threshold scales with resolution; flag uses area share not raw count', () => {
    function buildDressLike(scale: number) {
      const w = 100 * scale
      const h = 140 * scale
      const mask = createMaskBuffer(w, h, 0)
      // Main body — solid block
      for (let y = 30 * scale; y < 120 * scale; y += 1) {
        for (let x = 25 * scale; x < 75 * scale; x += 1) {
          mask.data[y * w + x] = 255
        }
      }
      // Isolated 1px dust only in the top margin (never adjacent to each other)
      const dustTarget = 40 * scale
      let dust = 0
      for (let i = 0; i < dustTarget; i += 1) {
        const x = 2 + (i % 20) * 4
        const y = 2 + Math.floor(i / 20) * 4
        if (x >= w || y >= 25 * scale) continue
        mask.data[y * w + x] = 255
        dust += 1
      }
      return { mask, w, h, dust }
    }

    const low = buildDressLike(1)
    const high = buildDressLike(4)
    const aLow = analyzeKeepComponents(low.mask)
    const aHigh = analyzeKeepComponents(high.mask)

    expect(aHigh.summary.noiseAreaPx).toBeGreaterThanOrEqual(aLow.summary.noiseAreaPx)
    expect(aLow.summary.largestAreaShare).toBeGreaterThan(0.9)
    expect(aHigh.summary.largestAreaShare).toBeGreaterThan(0.9)
    expect(aHigh.summary.totalComponents).toBeGreaterThan(aLow.summary.totalComponents)
    expect(aLow.summary.noiseComponents).toBeGreaterThan(10)
    expect(aHigh.summary.noiseComponents).toBeGreaterThan(aLow.summary.noiseComponents)

    const fLow = shouldFlagFragmentation(aLow.summary, 'neural')
    const fHigh = shouldFlagFragmentation(aHigh.summary, 'neural')
    expect(fLow.flag).toBe(false)
    expect(fHigh.flag).toBe(false)
    expect(fLow.unit).toMatch(/detached_significant_area_share/)
  })

  it('thin strap attached to body remains one component at alpha>=128', () => {
    const w = 60
    const h = 80
    const mask = createMaskBuffer(w, h, 0)
    // Body
    for (let y = 40; y < 70; y += 1) {
      for (let x = 20; x < 40; x += 1) mask.data[y * w + x] = 255
    }
    // Strap contiguous into the body top edge (y=40)
    for (let y = 15; y <= 40; y += 1) {
      mask.data[y * w + 29] = 255
      mask.data[y * w + 30] = 255
    }
    const a = analyzeKeepComponents(mask)
    expect(a.summary.totalComponents).toBe(1)
    expect(a.summary.significantComponents).toBe(1)
    expect(shouldFlagFragmentation(a.summary, 'neural').flag).toBe(false)
  })
})
