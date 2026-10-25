import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_BG_REMOVE_HF_MODEL_ID,
  isAllowedBgRemoveModelId,
  resetBgRemoveModelIdWarningForTests,
  resolveBgRemoveModelId,
} from './bgRemoveSdk'

describe('resolveBgRemoveModelId allowlist', () => {
  afterEach(() => {
    resetBgRemoveModelIdWarningForTests()
    vi.restoreAllMocks()
  })

  it('treats unset, empty, and whitespace as SDK default (undefined override)', () => {
    expect(resolveBgRemoveModelId(undefined)).toBeUndefined()
    expect(resolveBgRemoveModelId(null)).toBeUndefined()
    expect(resolveBgRemoveModelId('')).toBeUndefined()
    expect(resolveBgRemoveModelId('   \t  ')).toBeUndefined()
  })

  it('accepts the approved production HF id and canonicalizes case/whitespace', () => {
    expect(resolveBgRemoveModelId('briaai/RMBG-1.4')).toBe(
      DEFAULT_BG_REMOVE_HF_MODEL_ID,
    )
    expect(resolveBgRemoveModelId('  briaai/RMBG-1.4  ')).toBe(
      DEFAULT_BG_REMOVE_HF_MODEL_ID,
    )
    expect(resolveBgRemoveModelId('briaai/rmbg-1.4')).toBe(
      DEFAULT_BG_REMOVE_HF_MODEL_ID,
    )
    expect(isAllowedBgRemoveModelId('BRIAAi/RMBG-1.4')).toBe(true)
  })

  it('accepts mirrors that still identify RMBG-1.4', () => {
    expect(
      resolveBgRemoveModelId('https://cdn.example.com/weights/RMBG-1.4'),
    ).toBe('https://cdn.example.com/weights/RMBG-1.4')
    expect(resolveBgRemoveModelId('my-org/RMBG-1.4-fp16')).toBe(
      'my-org/RMBG-1.4-fp16',
    )
  })

  it('rejects unsupported model families deterministically', () => {
    const rejected = [
      'edgetools/u2netp',
      'u2netp',
      'U2-Net',
      'ZhengPeng7/BiRefNet',
      'birefnet-lite',
      'briaai/RMBG-2.0',
      'Xenova/modnet',
      'isnet-general-use',
    ]
    for (const id of rejected) {
      expect(isAllowedBgRemoveModelId(id)).toBe(false)
      expect(resolveBgRemoveModelId(id)).toBeUndefined()
    }
  })

  it('warns once without echoing the rejected value (no secret leak)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(resolveBgRemoveModelId('secret-token@cdn/u2netp')).toBeUndefined()
    expect(resolveBgRemoveModelId('another/BiRefNet')).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0] ?? '')
    expect(message).toMatch(/Ignoring VITE_BG_REMOVE_MODEL_ID/)
    expect(message).toMatch(/briaai\/RMBG-1\.4/)
    expect(message).not.toMatch(/secret-token/)
    expect(message).not.toMatch(/u2netp|BiRefNet/i)
  })
})
