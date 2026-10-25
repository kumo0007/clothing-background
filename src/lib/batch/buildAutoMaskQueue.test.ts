import { describe, expect, it } from 'vitest'
import {
  buildAutoMaskQueue,
  countPendingMasks,
} from './buildAutoMaskQueue'
import type { UploadedImage } from '../../types'
import { createEmptyMaskMeta, type MaskStateMeta } from '../../types/mask'

function img(id: string, name = `${id}.jpg`): UploadedImage {
  return {
    id,
    name,
    objectUrl: `blob:${id}`,
    width: 10,
    height: 10,
    file: new File([], name),
  }
}

function project(meta: Partial<MaskStateMeta>) {
  return { maskMeta: { ...createEmptyMaskMeta(), ...meta } }
}

describe('buildAutoMaskQueue', () => {
  const images = [
    img('a'),
    img('b'),
    img('c'),
    img('d'),
  ]

  it('all includes pending and failed, skips successful and manual', () => {
    const projects = {
      a: project({}),
      b: project({ hasEdits: true, autoMethodUsed: 'bg-remove-sdk-rmbg1.4' }),
      c: project({ autoFailed: true, needsReview: true }),
      d: project({ hasEdits: true, hasManualEdits: true }),
    }
    const queue = buildAutoMaskQueue(images, projects, 'all', null)
    expect(queue.map((i) => i.id)).toEqual(['a', 'c'])
  })

  it('failed only returns autoFailed images', () => {
    const projects = {
      a: project({}),
      b: project({ autoFailed: true }),
      c: project({ hasEdits: true }),
    }
    expect(
      buildAutoMaskQueue(images.slice(0, 3), projects, 'failed', null).map(
        (i) => i.id,
      ),
    ).toEqual(['b'])
  })

  it('selected skips successful masks and requires a selection', () => {
    const projects = {
      a: project({ hasEdits: true }),
      b: project({}),
    }
    expect(buildAutoMaskQueue(images, projects, 'selected', null)).toEqual([])
    expect(
      buildAutoMaskQueue(images, projects, 'selected', 'a').map((i) => i.id),
    ).toEqual([])
    expect(
      buildAutoMaskQueue(images, projects, 'selected', 'b').map((i) => i.id),
    ).toEqual(['b'])
  })

  it('countPendingMasks excludes masked and failed', () => {
    const projects = {
      a: project({}),
      b: project({ hasEdits: true }),
      c: project({ autoFailed: true }),
      d: project({ processingPhase: 'pending' }),
    }
    expect(countPendingMasks(images, projects)).toBe(2)
  })
})
