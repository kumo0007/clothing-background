/**
 * Capture Firefox's exact console wording when a document CSP is
 * literally `script-src 'none'` (control), vs production top-level.
 */
import { firefox } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const production =
  process.argv[2] ?? 'https://garment-background-studio.vercel.app/'
const outDir = join('tmp-release-validation', 'browser-compat')
mkdirSync(outDir, { recursive: true })

const asset = `${production.replace(/\/$/, '')}/assets/index-C3JO3DUu.js`

const server = createServer((req, res) => {
  if (req.url === '/forced-none.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; script-src 'none'",
    })
    res.end(`<!doctype html><html><head>
<script type="module" src="${asset}"></script>
</head><body><div id="root">forced-none</div></body></html>`)
    return
  }
  res.writeHead(404)
  res.end('no')
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as { port: number }).port

const browser = await firefox.launch({ headless: true })

async function run(url: string, label: string) {
  const page = await browser.newPage()
  const consoleMsgs: string[] = []
  const pageErrors: string[] = []
  page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(2500)
  const diag = await page.evaluate(() => ({
    href: location.href,
    isTop: window.top === window.self,
    rootText: document.getElementById('root')?.textContent?.slice(0, 80) ?? null,
    rootChildren: document.getElementById('root')?.childElementCount ?? -1,
    hasHeading: !!document.querySelector('h1'),
  }))
  await page.close()
  const all = [...consoleMsgs, ...pageErrors]
  return {
    label,
    url,
    diag,
    consoleMsgs,
    pageErrors,
    mentionsScriptSrcNone: all.some((m) => /script-src ['"]?none['"]?/i.test(m)),
    loadingFailedModule: all.some((m) => /Loading failed for the module/i.test(m)),
  }
}

const forced = await run(
  `http://127.0.0.1:${port}/forced-none.html`,
  'document-csp-script-src-none',
)
const top = await run(production, 'production-top-level')

const result = {
  forced,
  top,
  comparison: {
    forcedBlocksWithNoneMessage: forced.mentionsScriptSrcNone,
    productionTopLevelMentionsNone: top.mentionsScriptSrcNone,
    productionRenders: top.diag.hasHeading === true && top.diag.rootChildren > 0,
  },
}

writeFileSync(
  join(outDir, 'firefox-forced-none-vs-production.json'),
  JSON.stringify(result, null, 2),
)
console.log(JSON.stringify(result, null, 2))
server.close()
await browser.close()
