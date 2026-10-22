import { describe, expect, it } from 'vitest'
import { createMaskBuffer } from './createMask'
import {
  dilateMask,
  erodeMask,
  featherMaskEdges,
  fillMaskHoles,
  morphCloseMask,
  morphOpenMask,
} from './refineMask'

describe('refineMask', () => {
  it('erodes keep regions and dilates them back with open/close', () => {
    const mask = createMaskBuffer(9, 9, 0)
    // 3×3 keep block in the center
    for (let y = 3; y <= 5; y += 1) {
      for (let x = 3; x <= 5; x += 1) {
        mask.data[y * 9 + x] = 255
      }
    }
    // single-pixel keep speckles
    mask.data[1 * 9 + 1] = 255
    mask.data[1 * 9 + 7] = 255

    morphOpenMask(mask, 1)
    expect(mask.data[1 * 9 + 1]).toBe(0)
    expect(mask.data[1 * 9 + 7]).toBe(0)
    expect(mask.data[4 * 9 + 4]).toBe(255)
  })

  it('closing fills a one-pixel hole inside keep', () => {
    const mask = createMaskBuffer(7, 7, 0)
    for (let y = 1; y <= 5; y += 1) {
      for (let x = 1; x <= 5; x += 1) {
        mask.data[y * 7 + x] = 255
      }
    }
    mask.data[3 * 7 + 3] = 0

    morphCloseMask(mask, 1)
    expect(mask.data[3 * 7 + 3]).toBe(255)
  })

  it('fillMaskHoles fills enclosed remove regions but not border-connected ones', () => {
    const mask = createMaskBuffer(8, 8, 255)
    // Enclosed hole
    mask.data[3 * 8 + 3] = 0
    mask.data[3 * 8 + 4] = 0
    mask.data[4 * 8 + 3] = 0
    mask.data[4 * 8 + 4] = 0
    // Border-connected remove (should stay)
    for (let y = 0; y < 8; y += 1) {
      mask.data[y * 8 + 0] = 0
    }

    const filled = fillMaskHoles(mask)
    expect(filled).toBe(4)
    expect(mask.data[3 * 8 + 3]).toBe(255)
    expect(mask.data[0]).toBe(0)
    expect(mask.data[4 * 8]).toBe(0)
  })

  it('fillMaskHoles skips oversized enclosed gaps', () => {
    const mask = createMaskBuffer(10, 10, 255)
    for (let y = 2; y <= 7; y += 1) {
      for (let x = 2; x <= 7; x += 1) {
        mask.data[y * 10 + x] = 0
      }
    }
    const filled = fillMaskHoles(mask, 10)
    expect(filled).toBe(0)
    expect(mask.data[4 * 10 + 4]).toBe(0)
  })

  it('feather introduces gray edge values without inventing garment content', () => {
    const mask = createMaskBuffer(20, 20, 0)
    for (let y = 5; y < 15; y += 1) {
      for (let x = 5; x < 15; x += 1) {
        mask.data[y * 20 + x] = 255
      }
    }

    featherMaskEdges(mask, 2)
    const values = new Set(Array.from(mask.data))
    expect(values.has(0)).toBe(true)
    expect(values.has(255)).toBe(true)
    const hasGray = [...values].some((value) => value > 0 && value < 255)
    expect(hasGray).toBe(true)
    // Far exterior stays remove
    expect(mask.data[0]).toBe(0)
    // Neighbor REMOVE just outside the block must stay 0 (no studio halo).
    expect(mask.data[5 * 20 + 4]).toBe(0)
    // Deep interior stays keep
    expect(mask.data[10 * 20 + 10]).toBe(255)
  })

  it('erode then dilate round-trip shrinks then restores edge pixels', () => {
    const mask = createMaskBuffer(11, 11, 0)
    for (let y = 2; y <= 8; y += 1) {
      for (let x = 2; x <= 8; x += 1) {
        mask.data[y * 11 + x] = 255
      }
    }
    erodeMask(mask, 1)
    // Flat edge pixel is removed by erode
    expect(mask.data[2 * 11 + 5]).toBe(0)
    expect(mask.data[5 * 11 + 5]).toBe(255)
    dilateMask(mask, 1)
    // Dilate restores the flat edge (corners may stay soft with a disk kernel)
    expect(mask.data[2 * 11 + 5]).toBe(255)
  })
})
