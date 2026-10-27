/** Production SPA URL used when a local/VPN Vite origin cannot boot. */
export const PRODUCTION_APP_URL =
  'https://garment-background-studio.vercel.app/'

/**
 * True for IPv4 literals (e.g. Vite `--host` network URLs shown on phones).
 */
export function isIpHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (!host) return false
  if (host === 'localhost') return false
  // IPv6 (with or without brackets)
  if (host.includes(':')) return true
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1'
  )
}

/**
 * Astrill and similar VPNs expose Vite as 198.18.0.0/15. Phones often load
 * index.html but fail the ES-module graph, leaving the static boot fallback.
 */
export function isVpnDevTunnelHostname(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\./.exec(hostname.trim())
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 198 && (b === 18 || b === 19)
}

export function shouldAutoRedirectToProduction(
  hostname: string,
  search: string,
): boolean {
  if (/(?:^|[?&])dev=1(?:&|$)/.test(search)) return false
  return isVpnDevTunnelHostname(hostname)
}

export function productionUrlWithHash(hash: string): string {
  if (!hash || hash === '#') return PRODUCTION_APP_URL
  return `${PRODUCTION_APP_URL}${hash.startsWith('#') ? hash : `#${hash}`}`
}
