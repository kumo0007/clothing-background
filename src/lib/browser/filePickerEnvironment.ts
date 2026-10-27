/**
 * IDE Simple Browser / Electron webviews paint `<input type="file">` but do
 * not open the OS file dialog. Only treat clear desktop IDE UAs as restricted —
 * never flag real iPhone Firefox/Safari (that was a false-positive banner).
 */

export type FilePickerEnvironment = {
  /** True when the OS file dialog is unlikely to appear. */
  restricted: boolean
  reason: 'ok' | 'electron-webview' | 'vscode-webview'
  detail: string
}

/** iPhone / Android browsers — file picker works; do not show IDE warnings. */
export function isMobileBrowserUserAgent(ua: string): boolean {
  if (/Electron/i.test(ua)) return false
  return /iPhone|iPad|iPod|Android/i.test(ua) || /FxiOS|CriOS|EdgiOS/i.test(ua)
}

export function isIdeElectronUserAgent(ua: string): boolean {
  if (isMobileBrowserUserAgent(ua)) return false
  return /Electron/i.test(ua) || /Cursor\/\d/i.test(ua)
}

export function isVsCodeWebviewUserAgent(ua: string): boolean {
  if (isMobileBrowserUserAgent(ua)) return false
  // Word-boundary so random "Code/" substrings cannot match.
  return /\bCode\/\d/i.test(ua) || /\bVSCode\b/i.test(ua)
}

export function detectFilePickerEnvironment(
  options: {
    userAgent?: string
  } = {},
): FilePickerEnvironment {
  const ua =
    options.userAgent ??
    (typeof navigator !== 'undefined' ? navigator.userAgent : '')

  if (isMobileBrowserUserAgent(ua)) {
    return {
      restricted: false,
      reason: 'ok',
      detail: 'Mobile browser — native Photos / Files picker should open.',
    }
  }

  if (isIdeElectronUserAgent(ua)) {
    return {
      restricted: true,
      reason: 'electron-webview',
      detail:
        'This tab is an IDE Simple Browser (Electron). It cannot open the OS file dialog. Copy the URL into Chrome, Edge, Firefox, or Safari.',
    }
  }

  if (isVsCodeWebviewUserAgent(ua)) {
    return {
      restricted: true,
      reason: 'vscode-webview',
      detail:
        'VS Code / Cursor webview cannot open the OS file picker. Open the URL in an external browser.',
    }
  }

  return {
    restricted: false,
    reason: 'ok',
    detail: 'Top-level browser — native file picker should open.',
  }
}
