/**
 * Maps the eight polo-carpet screenshot scenarios to source fixtures.
 * Screenshots are visual evidence only — ground truth is the source files.
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BIREFNET_INPUT_SIZE } from './constants'

const root = join(__dirname, '../../../..')
const poloDir = join(
  root,
  'tmp-model-eval/polo-carpet-hw-accel-2026-10-28/sources',
)

/** Screenshot scenario → source fixture (product photos with tapes on carpet). */
export const POLO_CARPET_SCENARIOS = [
  {
    screenshotHint: '1 / horizontal tape alone or with shirt',
    id: 'polo-1',
    file: 'polo-1.png',
    tags: ['white-polo', 'carpet', 'tape-possible'],
  },
  {
    screenshotHint: '2 / white polo with tape',
    id: 'polo-2',
    file: 'polo-2.png',
    tags: ['white-polo', 'carpet'],
  },
  {
    screenshotHint: '3 / tape crossing shirt',
    id: 'polo-3',
    file: 'polo-3.jpg',
    tags: ['white-polo', 'carpet', 'tape-crossing'],
  },
  {
    screenshotHint: '4 / alternate tape orientation',
    id: 'polo-4',
    file: 'polo-4.jpg',
    tags: ['white-polo', 'carpet', 'tape-crossing'],
  },
  {
    screenshotHint: '5 / collar close-up labels/tags',
    id: 'polo-5',
    file: 'polo-5.png',
    tags: ['collar-closeup', 'labels', 'carpet'],
  },
  {
    screenshotHint: '6 / hem hard case (manual-required historically)',
    id: 'polo-6',
    file: 'polo-6.jpg',
    tags: ['hem', 'carpet', 'hard-case', 'webgpu-disagreement'],
  },
  {
    screenshotHint: '7 / additional horizontal tape polo',
    id: 'polo-7',
    file: 'polo-7.jpg',
    tags: ['white-polo', 'carpet', 'tape-crossing'],
  },
  {
    screenshotHint: '8 / isolated measuring tape / hard case',
    id: 'polo-8',
    file: 'polo-8.jpg',
    tags: ['tape', 'carpet', 'hard-case', 'manual-required'],
  },
] as const

describe('polo carpet fixture map', () => {
  it('all eight source fixtures exist on disk', () => {
    for (const s of POLO_CARPET_SCENARIOS) {
      const path = join(poloDir, s.file)
      expect(existsSync(path), `missing ${s.file}`).toBe(true)
      expect(statSync(path).size).toBeGreaterThan(10_000)
    }
  })

  it('documents model I/O contract for alignment checks', () => {
    expect(BIREFNET_INPUT_SIZE).toBe(512)
    // Production path: source W×H → stretch to 512×512 → bilinear α back to W×H.
    // No letterbox; mask.width/height must equal source after logitsToMaskBuffer.
  })

  it('marks polo-6/8 as hard cases that must not silently claim success', () => {
    const hard = POLO_CARPET_SCENARIOS.filter((s) =>
      (s.tags as readonly string[]).includes('hard-case'),
    )
    expect(hard.map((s) => s.id).sort()).toEqual(['polo-6', 'polo-8'])
  })
})
