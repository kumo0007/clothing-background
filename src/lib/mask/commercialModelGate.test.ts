/**
 * Locks the commercial-model milestone outcome: until a cleared alternative
 * passes clothing quality gates, production stays on bg-remove-sdk RMBG-1.4
 * and must not silently route to U²-Netp / BiRefNet / hosted APIs.
 *
 * Licensing readiness is enforced separately via
 * `commercialLicenseStatus.test.ts` + `assertCommercialReleaseGate.mts`.
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

const root = process.cwd()

describe('commercial model gate (no unjustified switch)', () => {
  it('keeps production method id on RMBG-1.4 via bg-remove-sdk', () => {
    expect(BG_REMOVE_SDK_METHOD).toBe('bg-remove-sdk-rmbg1.4')
    expect(BG_REMOVE_SDK_PROVIDER).toBe('bg-remove-sdk')
    expect(DEFAULT_BG_REMOVE_HF_MODEL_ID).toBe('briaai/RMBG-1.4')
  })

  it('does not wire U²-Netp or BiRefNet into the segmentation entrypoints', () => {
    // App + pipeline must not import/call alternate models. bgRemoveSdk may
    // mention banned names only inside the env allowlist denylist.
    for (const rel of ['src/lib/mask/autoMaskPipeline.ts', 'src/App.tsx']) {
      const src = readFileSync(join(root, rel), 'utf8').toLowerCase()
      expect(src).not.toMatch(/u2netp|u2-netp|birefnet/)
    }
    const sdk = readFileSync(join(root, 'src/lib/mask/bgRemoveSdk.ts'), 'utf8')
    expect(sdk).toMatch(/BG_REMOVE_SDK_METHOD = 'bg-remove-sdk-rmbg1\.4'/)
    expect(sdk).not.toMatch(/from ['"][^'"]*(u2netp|birefnet)/i)
    expect(sdk).not.toMatch(/segmentWithU2|runBiRefNet/i)
  })

  it('records license+quality no-switch decision in eval report', () => {
    const report = readFileSync(
      join(root, 'tmp-model-eval/COMMERCIAL_MODEL_COMPARISON_REPORT.md'),
      'utf8',
    )
    expect(report).toMatch(/Do not switch production default/i)
    expect(report).toMatch(/BiRefNet-lite[\s\S]*Not downloaded/i)
    expect(report).toMatch(/Clothing cutout quality[\s\S]*\*\*Fail\*\*/i)
  })

  it('rejects env model ids that would switch away from RMBG-1.4', () => {
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
    expect(resolveBgRemoveModelId('ZhengPeng7/BiRefNet')).toBeUndefined()
  })
})
