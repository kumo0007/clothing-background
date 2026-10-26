/**
 * Reproduce the reported Firefox failure:
 * - Console: Loading failed for module …/assets/index-C3JO3DUu.js
 * - Console: blocked by script-src 'none'
 * - UI: boot-static-fallback stays visible
 *
 * Mechanism: document is NOT governed by Vercel CSP; it runs under HTML
 * iframe sandbox without allow-scripts (forced CSP script-src 'none').
 * Absolute production asset URLs match the client console exactly.
 */
import { firefox } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'

const production =
  process.argv[2] ?? 'https://garment-background-studio.vercel.app/'
const asset = `${production.replace(/\/$/, '')}/assets/index-C3JO3DUu.js`
const css = `${production.replace(/\/$/, '')}/assets/index-DL3_6wAk.css`
const outDir = join('tmp-release-validation', 'browser-compat')
mkdirSync(outDir, { recursive: true })

const childHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Garment Background Studio</title>
    <script type="module" crossorigin src="${asset}"></script>
    <link rel="stylesheet" crossorigin href="${css}">
  </head>
  <body>
    <div id="root">
      <div class="app-boot-error" id="boot-static-fallback" data-testid="boot-static-fallback" role="status">
        <h1>Loading Garment Background Studio…</h1>
        <p>If this message does not go away, the browser blocked the app scripts.</p>
      </div>
    </div>
  </body>
</html>`

const server = createServer((req, res) => {
  if (req.url === '/child.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(childHtml)
    return
  }
  if (req.url === '/preview-sandboxed.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html><body>
<iframe id="f" title="mobile-preview" sandbox="allow-same-origin" src="/child.html" style="width:390px;height:700px;border:1px solid #ccc"></iframe>
</body></html>`)
    return
  }
  if (req.url === '/preview-allow-scripts.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html><body>
<iframe id="f" title="mobile-preview" sandbox="allow-same-origin allow-scripts allow-forms" src="/child.html" style="width:390px;height:700px;border:1px solid #ccc"></iframe>
</body></html>`)
    return
  }
  res.writeHead(404)
  res.end('no')
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as { port: number }).port
const base = `http://127.0.0.1:${port}`

const browser = await firefox.launch({ headless: true })

async function run(path: string, label: string) {
  const page = await browser.newPage()
  const consoleMsgs: string[] = []
  page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`))
  await page.goto(`${base}${path}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForTimeout(3500)
  // Attach listeners on child frame too (parent page console often misses them).
  for (const frame of page.frames()) {
    frame.on('console', (m) =>
      consoleMsgs.push(`[frame:${frame.url()}][${m.type()}] ${m.text()}`),
    )
  }
  // Force a second navigation of the iframe to re-emit load errors after listeners.
  await page.evaluate(() => {
    const f = document.getElementById('f') as HTMLIFrameElement
    f.src = f.src
  })
  await page.waitForTimeout(3500)
  const child = await page.evaluate(() => {
    const f = document.getElementById('f') as HTMLIFrameElement
    const doc = f.contentDocument
    return {
      sandbox: f.getAttribute('sandbox'),
      fallbackVisible: !!doc?.getElementById('boot-static-fallback'),
      rootChildren: doc?.getElementById('root')?.childElementCount ?? -1,
      scriptSrcs: doc ? [...doc.scripts].map((s) => s.src) : [],
    }
  })
  await page.screenshot({
    path: join(outDir, `firefox-${label}.png`),
    fullPage: true,
  })
  await page.close()
  const joined = consoleMsgs.join('\n')
  return {
    label,
    child,
    consoleMsgs,
    mentionsScriptSrcNone: /script-src ['"]?none['"]?/i.test(joined),
    loadingFailedModule: /Loading failed for the module/i.test(joined),
    blocksProductionAsset: new RegExp(
      asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i',
    ).test(joined),
  }
}

const sandboxed = await run('/preview-sandboxed.html', 'preview-sandboxed')
const allowScripts = await run(
  '/preview-allow-scripts.html',
  'preview-allow-scripts',
)

// Top-level production control
const top = await browser.newPage()
const topConsole: string[] = []
top.on('console', (m) => topConsole.push(`[${m.type()}] ${m.text()}`))
const topCsps: string[] = []
top.on('response', (res) => {
  if (res.url().replace(/\/$/, '') === production.replace(/\/$/, '')) {
    for (const [k, v] of Object.entries(res.headers())) {
      if (k.toLowerCase() === 'content-security-policy') topCsps.push(v)
    }
  }
})
await top.goto(production, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await top.waitForSelector('#root > *:not(#boot-static-fallback)', {
  timeout: 30_000,
}).catch(() => null)
await top.waitForTimeout(2000)
const topDiag = await top.evaluate(() => ({
  isTop: window.top === window.self,
  fallback: !!document.getElementById('boot-static-fallback'),
  heading: document.querySelector('h1')?.textContent ?? null,
}))
await top.screenshot({
  path: join(outDir, 'firefox-production-toplevel.png'),
  fullPage: true,
})
await top.close()

const result = {
  production,
  asset,
  sandboxed,
  allowScripts,
  topLevel: {
    docCsps: topCsps,
    diagnosis: topDiag,
    consoleMsgs: topConsole,
    mentionsScriptSrcNone: topConsole.some((m) =>
      /script-src ['"]?none['"]?/i.test(m),
    ),
  },
  confirmedSource:
    sandboxed.mentionsScriptSrcNone &&
    sandboxed.loadingFailedModule &&
    sandboxed.blocksProductionAsset &&
    sandboxed.child.fallbackVisible &&
    !topLevelMentionsNone(topConsole) &&
    topDiag.fallback === false
      ? "HTML iframe sandbox without allow-scripts (forced script-src 'none'), not Vercel document CSP"
      : 'see logs',
}

function topLevelMentionsNone(msgs: string[]) {
  return msgs.some((m) => /script-src ['"]?none['"]?/i.test(m))
}

writeFileSync(
  join(outDir, 'firefox-preview-srcdoc-sandbox.json'),
  JSON.stringify(result, null, 2),
)
console.log(JSON.stringify(result, null, 2))
server.close()
await browser.close()
