/**
 * Writes vercel.json security headers from the shared CSP module.
 * Run: npx tsx scripts/generateVercelJson.mts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildContentSecurityPolicy } from '../src/lib/security/contentSecurityPolicy'

const csp = buildContentSecurityPolicy()

const vercelJson = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  headers: [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: csp,
        },
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        },
        {
          key: 'X-Frame-Options',
          value: 'DENY',
        },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=()',
        },
      ],
    },
  ],
}

const out = join(process.cwd(), 'vercel.json')
writeFileSync(out, `${JSON.stringify(vercelJson, null, 2)}\n`, 'utf8')
console.log('Wrote', out)
console.log('CSP:', csp)
