/**
 * Prove Firefox reports script-src 'none' for scripts inside a sandboxed
 * iframe that lacks allow-scripts — independent of the production CSP.
 *
 * Also compare against a top-level load of the same production entry module.
 */
import { firefox } from 'playwright-core'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'

const asset =
  process.argv[2] ??
  'https://garment-background-studio.vercel.app/assets/index-C3JO3DUu.js'
const production =
  process.argv[3] ?? 'https://garment-background-studio.vercel.app/'
const outDir = join('tmp-release-validation', 'browser-compat')
mkdirSync(outDir, { recursive: true })

function collect(page: import('playwright-core').Page) {
  const consoleMsgs: string[] = []
  const pageErrors: string[] = []
  const failed: string[] = []
  page.on('console', (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => pageErrors.push(err.message))
  page.on('requestfailed', (req) => {
    failed.push(`${req.url()} :: ${req.failure()?.errorText ?? 'unknown'}`)
  })
  return { consoleMsgs, pageErrors, failed }
}

function mentionsScriptSrcNone(msgs: string[]): boolean {
  return msgs.some((m) => /script-src ['"]?none['"]?/i.test(m))
}

const browser = await firefox.launch({ headless: true })

// --- A: sandboxed iframe loading a same-origin harness that pulls the module
const harnessHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script type="module" src="${asset}"></script>
<div id="root">sandbox-child</div>
</body></html>`

const server = createServer((req, res) => {
  if (req.url === '/child.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      // Deliberately NO CSP — sandbox alone should force script-src 'none'
    })
    res.end(harnessHtml)
    return
  }
  if (req.url === '/parent.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html><body>
<iframe id="f" sandbox="allow-same-origin" src="/child.html"></iframe>
</body></html>`)
    return
  }
  res.writeHead(404)
  res.end('no')
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const base = `http://127.0.0.1:${port}`

const sandboxPage = await browser.newPage()
const sandboxLogs = collect(sandboxPage)
await sandboxPage.goto(`${base}/parent.html`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
})
await sandboxPage.waitForTimeout(2500)

const sandboxFrameDiag = await sandboxPage.evaluate(() => {
  const f = document.getElementById('f') as HTMLIFrameElement
  const doc = f.contentDocument
  return {
    sandbox: f.getAttribute('sandbox'),
    childHref: doc?.location?.href ?? null,
    childScripts: doc
      ? [...doc.scripts].map((s) => ({ src: s.src, type: s.type }))
      : [],
    childRootText: doc?.getElementById('root')?.textContent ?? null,
  }
})
await sandboxPage.close()

// --- B: top-level production (control)
const topPage = await browser.newPage()
const topLogs = collect(topPage)
const topDocCsps: string[] = []
topPage.on('response', (res) => {
  if (res.url().replace(/\/$/, '') === production.replace(/\/$/, '')) {
    const raw =
      typeof res.headersArray === 'function' ? res.headersArray() : null
    const list = Array.isArray(raw)
      ? raw
      : Object.entries(res.headers()).map(([name, value]) => ({ name, value }))
    for (const h of list) {
      if (h.name.toLowerCase() === 'content-security-policy') {
        topDocCsps.push(h.value)
      }
    }
  }
})
await topPage.goto(production, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
})
await topPage.waitForSelector('#root > *', { timeout: 30_000 }).catch(() => null)
await topPage.waitForTimeout(2000)
const topDiag = await topPage.evaluate(() => ({
  isTop: window.top === window.self,
  rootChildren: document.getElementById('root')?.childElementCount ?? -1,
  hasHeading: !!document.querySelector('h1'),
  href: location.href,
}))
await topPage.screenshot({
  path: join(outDir, 'firefox-top-level-control.png'),
  fullPage: true,
})
await topPage.close()

const sandboxCombined = [
  ...sandboxLogs.consoleMsgs,
  ...sandboxLogs.pageErrors,
  ...sandboxLogs.failed,
]
const topCombined = [
  ...topLogs.consoleMsgs,
  ...topLogs.pageErrors,
  ...topLogs.failed,
]

const result = {
  mode: 'sandbox-vs-toplevel',
  asset,
  production,
  sandbox: {
    frameDiag: sandboxFrameDiag,
    consoleMsgs: sandboxLogs.consoleMsgs,
    pageErrors: sandboxLogs.pageErrors,
    failed: sandboxLogs.failed,
    matchesScriptSrcNone: mentionsScriptSrcNone(sandboxCombined),
  },
  topLevel: {
    diagnosis: topDiag,
    documentCsps: topDocCsps,
    consoleMsgs: topLogs.consoleMsgs,
    pageErrors: topLogs.pageErrors,
    failed: topLogs.failed,
    matchesScriptSrcNone: mentionsScriptSrcNone(topCombined),
    renders: topDiag.hasHeading && topDiag.rootChildren > 0,
  },
  conclusion:
    mentionsScriptSrcNone(sandboxCombined) &&
    !mentionsScriptSrcNone(topCombined) &&
    topDiag.hasHeading
      ? 'script-src none is reproducible only in sandboxed iframe without allow-scripts; top-level production CSP is fine'
      : 'see logs',
}

writeFileSync(
  join(outDir, 'firefox-sandbox-script-none.json'),
  JSON.stringify(result, null, 2),
)
console.log(JSON.stringify(result, null, 2))
server.close()
await browser.close()
