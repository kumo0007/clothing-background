/**
 * Production auto-mask uses BiRefNet_lite only (browser ONNX, MIT weights).
 * No silent RMBG / ISNet / Lab-seed fallback on the Batch UI path.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BG_REMOVE_SDK_METHOD,
  DEFAULT_BG_REMOVE_HF_MODEL_ID,
  isAllowedBgRemoveModelId,
  resolveBgRemoveModelId,
} from './bgRemoveSdk'
import { BIREFNET_METHOD, BIREFNET_PROVIDER } from './birefNet/constants'

const root = process.cwd()

describe('commercial model gate (BiRefNet sole auto-mask)', () => {
  it('keeps BiRefNet method ids pinned', () => {
    expect(BIREFNET_METHOD).toBe('birefnet-lite-512')
    expect(BIREFNET_PROVIDER).toBe('birefnet-onnx')
  })

  it('wires BiRefNet as the only automatic Batch backend (no RMBG fallback)', () => {
    const corners = readFileSync(
      join(root, 'src/lib/batch/autoMaskCorners.ts'),
      'utf8',
    )
    expect(corners).toMatch(/segmentWithBirefNet/)
    expect(corners).not.toMatch(/segmentWithBgRemoveSdk/)
    expect(corners).not.toMatch(/fallbackFrom/)
    expect(corners).toMatch(/AutoMaskBackend = 'birefnet'/)

    const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')
    expect(app).toMatch(/preloadBirefNetModel/)
    expect(app).not.toMatch(/preloadBgRemoveModel/)
    expect(app).not.toMatch(/autoMaskBackend/)
    expect(app).not.toMatch(/Falling back to RMBG/)

    const batch = readFileSync(
      join(root, 'src/components/BatchPanel.tsx'),
      'utf8',
    )
    expect(batch).toMatch(/BiRefNet/)
    expect(batch).not.toMatch(/Masking model/)
    expect(batch).not.toMatch(/Tips for iPhone/)
    expect(batch).not.toMatch(/RMBG-1\.4/)
    expect(batch).not.toMatch(/rmbg1\.4/)
    expect(batch).not.toMatch(/onAutoMaskBackendChange/)
  })

  it('leaves legacy SDK helper ids intact for non-UI scripts/tests only', () => {
    expect(BG_REMOVE_SDK_METHOD).toBe('bg-remove-sdk-rmbg1.4')
    expect(DEFAULT_BG_REMOVE_HF_MODEL_ID).toBe('briaai/RMBG-1.4')
    expect(resolveBgRemoveModelId('edgetools/u2netp')).toBeUndefined()
    expect(isAllowedBgRemoveModelId('edgetools/u2netp')).toBe(false)
    expect(resolveBgRemoveModelId('ZhengPeng7/BiRefNet')).toBeUndefined()
  })
})
