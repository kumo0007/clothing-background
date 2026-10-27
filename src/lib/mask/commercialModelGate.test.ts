/**
 * Production auto-mask default is BiRefNet_lite (browser ONNX, MIT weights).
 * RMBG-1.4 via bg-remove-sdk remains the explicit fallback / alternate option.
 * U²-Netp and arbitrary env model swaps stay blocked for the SDK path.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BG_REMOVE_SDK_METHOD,
  BG_REMOVE_SDK_PROVIDER,
  DEFAULT_BG_REMOVE_HF_MODEL_ID,
  isAllowedBgRemoveModelId,
  resolveBgRemoveModelId,
} from './bgRemoveSdk'
import { BIREFNET_METHOD, BIREFNET_PROVIDER } from './birefNet/constants'

const root = process.cwd()

describe('commercial model gate (BiRefNet default + RMBG fallback)', () => {
  it('keeps SDK fallback method id on RMBG-1.4 via bg-remove-sdk', () => {
    expect(BG_REMOVE_SDK_METHOD).toBe('bg-remove-sdk-rmbg1.4')
    expect(BG_REMOVE_SDK_PROVIDER).toBe('bg-remove-sdk')
    expect(DEFAULT_BG_REMOVE_HF_MODEL_ID).toBe('briaai/RMBG-1.4')
  })

  it('wires BiRefNet as the default auto-mask backend with RMBG fallback', () => {
    expect(BIREFNET_METHOD).toBe('birefnet-lite-512')
    expect(BIREFNET_PROVIDER).toBe('birefnet-onnx')

    const corners = readFileSync(
      join(root, 'src/lib/batch/autoMaskCorners.ts'),
      'utf8',
    )
    expect(corners).toMatch(/preferredBackend: AutoMaskBackend = 'birefnet'/)
    expect(corners).toMatch(/segmentWithBirefNet/)
    expect(corners).toMatch(/segmentWithBgRemoveSdk/)

    const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')
    expect(app).toMatch(/useState<AutoMaskBackend>\('birefnet'\)/)
    expect(app).toMatch(/preloadBirefNetModel/)

    const sdk = readFileSync(join(root, 'src/lib/mask/bgRemoveSdk.ts'), 'utf8')
    expect(sdk).toMatch(/BG_REMOVE_SDK_METHOD = 'bg-remove-sdk-rmbg1\.4'/)
    expect(sdk).not.toMatch(/from ['"][^'"]*u2netp/i)
    expect(sdk).not.toMatch(/segmentWithU2/i)
  })

  it('rejects env model ids that would switch the SDK path away from RMBG-1.4', () => {
    expect(resolveBgRemoveModelId('')).toBeUndefined()
    expect(resolveBgRemoveModelId('   ')).toBeUndefined()
    expect(resolveBgRemoveModelId(null)).toBeUndefined()
    expect(resolveBgRemoveModelId('briaai/RMBG-1.4')).toBe(
      DEFAULT_BG_REMOVE_HF_MODEL_ID,
    )
    expect(
      resolveBgRemoveModelId('https://cdn.example.com/models/RMBG-1.4'),
    ).toBe('https://cdn.example.com/models/RMBG-1.4')
    expect(isAllowedBgRemoveModelId('edgetools/u2netp')).toBe(false)
    expect(resolveBgRemoveModelId('edgetools/u2netp')).toBeUndefined()
    expect(resolveBgRemoveModelId('briaai/RMBG-2.0')).toBeUndefined()
    // BiRefNet is its own backend — not injectable via the SDK env allowlist.
    expect(resolveBgRemoveModelId('ZhengPeng7/BiRefNet')).toBeUndefined()
  })
})
