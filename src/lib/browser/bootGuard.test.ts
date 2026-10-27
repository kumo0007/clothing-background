import { describe, expect, it } from 'vitest'
import {
  isIpHostname,
  isLoopbackHostname,
  isVpnDevTunnelHostname,
  productionUrlWithHash,
  PRODUCTION_APP_URL,
  shouldAutoRedirectToProduction,
} from './bootGuard'

describe('bootGuard', () => {
  it('detects IPv4 Vite network hosts', () => {
    expect(isIpHostname('198.18.2.28')).toBe(true)
    expect(isIpHostname('192.168.1.10')).toBe(true)
    expect(isIpHostname('garment-background-studio.vercel.app')).toBe(false)
    expect(isIpHostname('localhost')).toBe(false)
  })

  it('flags Astrill-style 198.18/19 tunnel IPs for production redirect', () => {
    expect(isVpnDevTunnelHostname('198.18.2.28')).toBe(true)
    expect(isVpnDevTunnelHostname('198.19.0.1')).toBe(true)
    expect(isVpnDevTunnelHostname('192.168.1.10')).toBe(false)
    expect(shouldAutoRedirectToProduction('198.18.2.28', '')).toBe(true)
    expect(shouldAutoRedirectToProduction('198.18.2.28', '?dev=1')).toBe(false)
  })

  it('recognizes loopback', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('198.18.2.28')).toBe(false)
  })

  it('builds production URL with hash', () => {
    expect(productionUrlWithHash('')).toBe(PRODUCTION_APP_URL)
    expect(productionUrlWithHash('#main')).toBe(`${PRODUCTION_APP_URL}#main`)
  })
})
