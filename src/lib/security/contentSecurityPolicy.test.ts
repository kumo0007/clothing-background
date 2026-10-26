import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertAppCspAllowsBootstrap,
  buildContentSecurityPolicy,
  policyBlocksAllScripts,
} from './contentSecurityPolicy'

const root = process.cwd()

describe('contentSecurityPolicy', () => {
  it('buildContentSecurityPolicy allows self scripts and wasm, not script-src none', () => {
    const policy = buildContentSecurityPolicy()
    expect(policyBlocksAllScripts(policy)).toBe(false)
    expect(() => assertAppCspAllowsBootstrap(policy)).not.toThrow()
    expect(policy).toMatch(/script-src[^;]*'self'/)
    expect(policy).toMatch(/'wasm-unsafe-eval'/)
    expect(policy).toMatch(/script-src[^;]*blob:/)
    expect(policy).toMatch(/script-src[^;]*cdn\.jsdelivr\.net/)
    expect(policy).toMatch(/worker-src[^;]*blob:/)
    expect(policy).toMatch(/connect-src[^;]*huggingface\.co/)
    expect(policy).toMatch(/connect-src[^;]*cdn\.hf\.co/)
    expect(policy).toMatch(/connect-src[^;]*aws\.cdn\.hf\.co/)
    expect(policy).not.toMatch(/script-src\s+'none'/)
    expect(policy).not.toMatch(/'unsafe-inline'/)
    expect(policy).not.toMatch(/script-src[^;]*\*/)
  })

  it('detects default-src none fallback as script-blocking', () => {
    expect(policyBlocksAllScripts("default-src 'none'")).toBe(true)
    expect(policyBlocksAllScripts("default-src 'none'; script-src 'self'")).toBe(
      false,
    )
    expect(policyBlocksAllScripts("script-src 'none'")).toBe(true)
  })

  it('vercel.json headers ship the same bootstrap-safe CSP', () => {
    const raw = readFileSync(join(root, 'vercel.json'), 'utf8')
    const config = JSON.parse(raw) as {
      headers?: Array<{
        source: string
        headers: Array<{ key: string; value: string }>
      }>
    }
    const csp = config.headers
      ?.flatMap((h) => h.headers)
      ?.find((h) => h.key === 'Content-Security-Policy')
    expect(csp, 'vercel.json must define Content-Security-Policy').toBeTruthy()
    assertAppCspAllowsBootstrap(csp!.value)
    expect(csp!.value).toBe(buildContentSecurityPolicy())
  })

  it('index.html must not declare a conflicting CSP meta tag', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
    expect(html).not.toMatch(/http-equiv\s*=\s*["']Content-Security-Policy["']/i)
  })
})
