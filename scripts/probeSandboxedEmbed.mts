/**
 * Reproduce script-src 'none' when the production URL is loaded inside a
 * sandboxed iframe (no allow-scripts). This matches Firefox's forced CSP for
 * sandboxed frames — independent of vercel.json.
 */
import { firefox } from 'playwright-core'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const target = process.argv[2] ?? 'https://garment-background-studio.vercel.app/'
const outDir = join('tmp-release-validation', 'browser-compat')
mkdirSync(outDir, { recursive: true })

const browser = await firefox.launch({ headless: true })
const page = await browser.newPage()
const consoleMsgs: string[] = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleMsgs.push(msg.text())
})

const html = `<!doctype html><html><body>
<iframe id="f" src="${target}" sandbox="allow-same-origin" style="width:100%;height:90vh"></iframe>
</body></html>`

await page.setContent(html, { waitUntil: 'networkidle', timeout: 60_000 })
await page.waitForTimeout(3000)

const frameInfo = await page.evaluate(async () => {
  const f = document.getElementById('f') as HTMLIFrameElement
  let childError: string | null = null
  let childRoot = -1
  let childHref: string | null = null
  try {
    const doc = f.contentDocument
    childHref = doc?.location.href ?? null
    childRoot = doc?.getElementById('root')?.childElementCount ?? -1
  } catch (e) {
    childError = e instanceof Error ? e.message : String(e)
  }
  return {
    sandbox: f.sandbox.toString(),
    childHref,
    childRoot,
    childError,
  }
})

const result = {
  mode: 'sandboxed-iframe-no-allow-scripts',
  target,
  frameInfo,
  consoleMsgs,
  note: 'Browsers force CSP script-src none (or equivalent) on sandboxed iframes without allow-scripts. Top-level navigation is unaffected.',
}
writeFileSync(
  join(outDir, 'firefox-sandbox-embed-probe.json'),
  JSON.stringify(result, null, 2),
)
console.log(JSON.stringify(result, null, 2))
await browser.close()
