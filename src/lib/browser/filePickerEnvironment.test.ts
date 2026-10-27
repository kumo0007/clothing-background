import { describe, expect, it } from 'vitest'
import {
  detectFilePickerEnvironment,
  isMobileBrowserUserAgent,
} from './filePickerEnvironment'

const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/122.0 Mobile/15E148 Safari/605.1.15'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'

const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const CURSOR_ELECTRON =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Electron/28.0.0 Cursor/0.42.0'

describe('filePickerEnvironment', () => {
  it('does not flag iPhone Firefox or Safari as restricted', () => {
    expect(isMobileBrowserUserAgent(IPHONE_FIREFOX)).toBe(true)
    expect(
      detectFilePickerEnvironment({ userAgent: IPHONE_FIREFOX }).restricted,
    ).toBe(false)
    expect(
      detectFilePickerEnvironment({ userAgent: IPHONE_SAFARI }).restricted,
    ).toBe(false)
  })

  it('allows normal desktop Chrome', () => {
    expect(
      detectFilePickerEnvironment({ userAgent: DESKTOP_CHROME }).restricted,
    ).toBe(false)
  })

  it('flags Electron / Cursor Simple Browser only on desktop IDE UAs', () => {
    const env = detectFilePickerEnvironment({ userAgent: CURSOR_ELECTRON })
    expect(env.restricted).toBe(true)
    expect(env.reason).toBe('electron-webview')
  })

  it('does not treat framed-only pages as file-picker blocked', () => {
    // Framed detection removed — it false-positived on real phones and showed
    // a misleading Simple Browser banner.
    expect(
      detectFilePickerEnvironment({ userAgent: IPHONE_FIREFOX }).reason,
    ).toBe('ok')
  })
})
