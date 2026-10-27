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
      source: '/',
      headers: [
        {
          key: 'Cache-Control',
          value: 'no-store, must-revalidate',
        },
      ],
    },
    {
      source: '/index.html',
      headers: [
        {
          key: 'Cache-Control',
          value: 'no-store, must-revalidate',
        },
      ],
    },
    {
      source: '/models/(.*)',
      headers: [
        {
          key: 'Cache-Control',
          value: 'public, max-age=31536000, immutable',
        },
      ],
    },
    {
      source: '/bg-remove-worker.js',
      headers: [
        {
          key: 'Cache-Control',
          value: 'public, max-age=86400',
        },
      ],
    },
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
        // No X-Frame-Options: DENY — Firefox mobile/RDM embeds the page and
        // otherwise shows "cannot be simulated on Firefox".
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
