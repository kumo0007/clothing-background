/**
 * Capture the same evidence Firefox DevTools Network would show for the
 * production document, plus the CSP error source document URI when a
 * script-src 'none' policy is in effect (control) vs top-level production.
 */
import { firefox, type Page } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const production =
  process.argv[2] ?? 'https://garment-background-studio.vercel.app/'
const outDir = join('tmp-release-validation', 'browser-compat')
mkdirSync(outDir, { recursive: true })
const profileDir = mkdtempSync(join(tmpdir(), 'ff-devtools-'))

type DocCapture = {
  label: string
  url: string
  isTop: boolean
  frameElement: null | { sandbox: string | null; src: string }
  documentRequest: {
    url: string
    status: number
    cspHeaders: string[]
    reportOnlyHeaders: string[]
    allSecurityHeaders: Record<string, string>
  } | null
  metaCsp: Array<{ httpEquiv: string; content: string }>
  scripts: Array<{ src: string; type: string }>
  fallbackVisible: boolean
  heading: string | null
  consoleMsgs: string[]
  cspErrorSourceFiles: string[]
  mentionsScriptSrcNone: boolean
}

async function capturePage(page: Page, label: string, url: string): Promise<DocCapture> {
  const consoleMsgs: string[] = []
  let documentRequest: DocCapture['documentRequest'] = null

  page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`))
  page.on('response', async (res) => {
    const u = res.url().replace(/\/$/, '')
    const target = url.replace(/\/$/, '')
    if (u !== target && !(res.request().resourceType() === 'document' && u === target)) {
      // Prefer the main document navigation.
    }
    if (res.request().resourceType() !== 'document') return
    if (u !== target && !u.startsWith(target)) {
      // still allow exact path match for trailing slash variants
      try {
        if (new URL(res.url()).origin + new URL(res.url()).pathname.replace(/\/$/, '') !==
          new URL(url).origin + new URL(url).pathname.replace(/\/$/, '')) {
          return
        }
      } catch {
        return
      }
    }
    const headers = res.headers()
    const cspHeaders: string[] = []
    const reportOnlyHeaders: string[] = []
    const allSecurityHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase()
      if (lk === 'content-security-policy') cspHeaders.push(v)
      if (lk === 'content-security-policy-report-only') reportOnlyHeaders.push(v)
      if (
        lk.includes('content-security') ||
        lk === 'x-frame-options' ||
        lk === 'x-content-type-options' ||
        lk === 'referrer-policy'
      ) {
        allSecurityHeaders[k] = v
      }
    }
    documentRequest = {
      url: res.url(),
      status: res.status(),
      cspHeaders,
      reportOnlyHeaders,
      allSecurityHeaders,
    }
  })

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(2500)

  const diag = await page.evaluate(() => {
    const fe = window.frameElement as HTMLIFrameElement | null
    return {
      href: location.href,
      isTop: window.top === window.self,
      frameElement: fe
        ? { sandbox: fe.getAttribute('sandbox'), src: fe.src }
        : null,
      metaCsp: [...document.querySelectorAll('meta')].map((m) => ({
        httpEquiv: m.httpEquiv,
        content: m.content?.slice(0, 400) ?? '',
      })),
      scripts: [...document.scripts].map((s) => ({
        src: s.src,
        type: s.type,
      })),
      fallbackVisible: !!document.getElementById('boot-static-fallback'),
      heading: document.querySelector('h1')?.textContent ?? null,
    }
  })

  const cspErrorSourceFiles = consoleMsgs
    .map((m) => {
      const match = /\{file:\s*"([^"]+)"/.exec(m)
      return match?.[1] ?? null
    })
    .filter((x): x is string => !!x)

  return {
    label,
    url,
    isTop: diag.isTop,
    frameElement: diag.frameElement,
    documentRequest,
    metaCsp: diag.metaCsp.filter((m) =>
      /content-security-policy/i.test(m.httpEquiv),
    ),
    scripts: diag.scripts,
    fallbackVisible: diag.fallbackVisible,
    heading: diag.heading,
    consoleMsgs,
    cspErrorSourceFiles,
    mentionsScriptSrcNone: consoleMsgs.some((m) =>
      /script-src ['"]?none['"]?/i.test(m),
    ),
  }
}

const context = await firefox.launchPersistentContext(profileDir, {
  headless: true,
})
const page = await context.newPage()

const productionCapture = await capturePage(page, 'production-toplevel', production)
await page.screenshot({
  path: join(outDir, 'firefox-devtools-production.png'),
  fullPage: true,
})

// Control: document with script-src 'none' — capture source link file URI
const asset = `${production.replace(/\/$/, '')}/assets/index-C3JO3DUu.js`
const server = createServer((req, res) => {
  if (req.url === '/forced-none.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; script-src 'none'",
    })
    res.end(`<!doctype html><html><head>
<script type="module" src="${asset}"></script>
</head><body><div id="root"><div id="boot-static-fallback">Loading…</div></div></body></html>`)
    return
  }
  res.writeHead(404)
  res.end('no')
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as { port: number }).port

const controlPage = await context.newPage()
const controlCapture = await capturePage(
  controlPage,
  'control-script-src-none',
  `http://127.0.0.1:${port}/forced-none.html`,
)
await controlPage.screenshot({
  path: join(outDir, 'firefox-devtools-forced-none.png'),
  fullPage: true,
})

const result = {
  profileDir,
  productionCapture,
  controlCapture,
  interpretation: {
    productionDocumentHasScriptSrcNone:
      productionCapture.documentRequest?.cspHeaders.some((c) =>
        /script-src\s+'none'/i.test(c),
      ) ?? false,
    controlErrorOwnedByLocalDocument: controlCapture.cspErrorSourceFiles.some(
      (f) => f.includes('forced-none.html'),
    ),
    productionTopLevelRenders:
      productionCapture.fallbackVisible === false &&
      !!productionCapture.heading &&
      !productionCapture.mentionsScriptSrcNone,
  },
}

writeFileSync(
  join(outDir, 'firefox-devtools-evidence.json'),
  JSON.stringify(result, null, 2),
)
console.log(JSON.stringify(result, null, 2))
server.close()
await context.close()
