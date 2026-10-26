import { describe, expect, it } from 'vitest'
import {
  describeDevicePreference,
  isAppleMobileUserAgent,
  isSafariFamilyUserAgent,
  isWebGpuBackendInitFailure,
  resolvePreferredBgRemoveDevice,
} from './bgRemoveDevice'

describe('bgRemoveDevice', () => {
  it('detects iPhone Safari and prefers WASM', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    expect(isAppleMobileUserAgent(ua)).toBe(true)
    expect(isSafariFamilyUserAgent(ua)).toBe(true)
    expect(resolvePreferredBgRemoveDevice(ua)).toBe('wasm')
  })

  it('detects iPadOS desktop UA via touch points', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    expect(isAppleMobileUserAgent(ua, 5)).toBe(true)
    expect(resolvePreferredBgRemoveDevice(ua, 5)).toBe('wasm')
  })

  it('keeps auto on desktop Chrome', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
    expect(isSafariFamilyUserAgent(ua)).toBe(false)
    expect(resolvePreferredBgRemoveDevice(ua)).toBe('auto')
  })

  it('prefers WASM for iOS Chrome (CriOS) — same WebKit ORT limits', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1'
    expect(resolvePreferredBgRemoveDevice(ua)).toBe('wasm')
  })

  it('classifies the client WebGPU module-import failure', () => {
    const msg =
      'no available backend found. ERR: [webgpu] TypeError: Importing a module script failed.'
    expect(isWebGpuBackendInitFailure(msg)).toBe(true)
    expect(
      isWebGpuBackendInitFailure(
        'no available backend found. ERR: [wasm] Error: boom',
      ),
    ).toBe(false)
  })

  it('describes preferences for diagnostics', () => {
    expect(describeDevicePreference('wasm')).toMatch(/wasm/i)
    expect(describeDevicePreference('auto')).toMatch(/auto/i)
  })
})
