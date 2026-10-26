/**
 * Capture CSP violations and security headers in Firefox for the production app.
 */
import { firefox } from 'playwright-core'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2] ?? 'https://garment-background-studio.vercel.app/'
const outDir = join('tmp-release-validation', 'browser-compat')
mkdirSync(outDir, { recursive: true })

const browser = await firefox.launch({ headless: true })
const page = await browser.newPage()

const consoleMsgs: Array<{ type: string; text: string }> = []
const pageErrors: string[] = []
const cspViolations: unknown[] = []
const responseHeaders: Record<string, Record<string, string>> = {}

page.on('console', (msg) => {
  consoleMsgs.push({ type: msg.type(), text: msg.text() })
})
page.on('pageerror', (err) => {
  pageErrors.push(err.message)
})
page.on('response', async (res) => {
  const u = res.url()
  if (
    u === url ||
    u.endsWith('/') ||
    /\/assets\/index-.*\.js$/.test(u) ||
    /\/assets\/index-.*\.css$/.test(u)
  ) {
    responseHeaders[u] = res.headers()
  }
})

await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
await page.waitForTimeout(2500)

const docCsp = await page.evaluate(() => {
  const metas = [...document.querySelectorAll('meta')].map((m) => ({
    httpEquiv: m.httpEquiv,
    name: m.getAttribute('name'),
    content: m.content,
  }))
  const scripts = [...document.scripts].map((s) => ({
    src: s.src,
    type: s.type,
    crossOrigin: s.crossOrigin,
  }))
  return {
    metas,
    scripts,
    rootChildren: document.getElementById('root')?.childElementCount ?? -1,
    title: document.title,
    hasHeading: !!document.querySelector('h1'),
  }
})

// Ask Firefox for CSP via SecurityPolicyViolation if any fired
const violationLog = await page.evaluate(() => {
  return (window as unknown as { __csp?: unknown[] }).__csp ?? []
})

await page.screenshot({
  path: join(outDir, 'firefox-csp-probe.png'),
  fullPage: true,
})

const result = {
  url,
  docCsp,
  violationLog,
  consoleMsgs,
  pageErrors,
  responseHeaders,
  cspViolations,
}
writeFileSync(join(outDir, 'firefox-csp-probe.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
await browser.close()
