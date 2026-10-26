/**
 * Identify every CSP source for the production document in Firefox.
 * Does not modify CSP — diagnostics only.
 */
import { firefox } from 'playwright-core'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2] ?? 'https://garment-background-studio.vercel.app/'
const outDir = join('tmp-release-validation', 'browser-compat')
mkdirSync(outDir, { recursive: true })

const browser = await firefox.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()

const consoleMsgs: Array<{ type: string; text: string }> = []
const pageErrors: string[] = []
const documentHeaders: string[][] = []
const assetHeaders: Record<string, string[][]> = {}

page.on('console', (msg) => consoleMsgs.push({ type: msg.type(), text: msg.text() }))
page.on('pageerror', (err) => pageErrors.push(err.message))

page.on('response', (res) => {
  const u = res.url()
  const all = Object.entries(res.headers())
  const pairs = all.filter(([name]) => /content-security-policy/i.test(name))
  if (!pairs.length) return
  let path = ''
  try {
    path = new URL(u).pathname
  } catch {
    path = u
  }
  if (path === '/' || u === url) {
    documentHeaders.push(...pairs.map(([n, v]) => [n, v]))
  }
  if (/\/assets\/index-.*\.js$/.test(path)) {
    assetHeaders[u] = pairs.map(([n, v]) => [n, v])
  }
})

await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) => {
    const w = window as unknown as { __cspViolations?: unknown[] }
    w.__cspViolations = w.__cspViolations ?? []
    w.__cspViolations.push({
      blockedURI: e.blockedURI,
      violatedDirective: e.violatedDirective,
      effectiveDirective: e.effectiveDirective,
      originalPolicy: e.originalPolicy,
      disposition: e.disposition,
      documentURI: e.documentURI,
      sourceFile: e.sourceFile,
    })
  })
})

await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
await page.waitForTimeout(2000)

const pageInfo = await page.evaluate(() => {
  const w = window as unknown as { __cspViolations?: unknown[] }
  const metas = [...document.querySelectorAll('meta')].map((m) => ({
    httpEquiv: m.httpEquiv,
    name: m.getAttribute('name'),
    content: m.content,
  }))
  const frames = [...document.querySelectorAll('iframe')].map((f) => ({
    src: f.src,
    sandbox: f.sandbox.toString(),
  }))
  return {
    origin: location.origin,
    href: location.href,
    isTop: window.top === window,
    frameElement: !!window.frameElement,
    rootChildren: document.getElementById('root')?.childElementCount ?? -1,
    hasHeading: !!document.querySelector('h1'),
    scripts: [...document.scripts].map((s) => ({
      src: s.src,
      type: s.type,
      crossOrigin: s.crossOrigin,
    })),
    metas,
    frames,
    serviceWorkerControllers: navigator.serviceWorker?.controller
      ? navigator.serviceWorker.controller.scriptURL
      : null,
    cspViolations: w.__cspViolations ?? [],
  }
})

const swRegs = await page.evaluate(async () => {
  if (!navigator.serviceWorker) return []
  const regs = await navigator.serviceWorker.getRegistrations()
  return regs.map((r) => ({
    scope: r.scope,
    active: r.active?.scriptURL ?? null,
    waiting: r.waiting?.scriptURL ?? null,
  }))
})

await page.screenshot({
  path: join(outDir, 'firefox-csp-source-probe.png'),
  fullPage: true,
})

const result = {
  url,
  documentHeaders,
  assetHeaders,
  pageInfo,
  swRegs,
  consoleMsgs,
  pageErrors,
}
writeFileSync(
  join(outDir, 'firefox-csp-source-probe.json'),
  JSON.stringify(result, null, 2),
)
console.log(JSON.stringify(result, null, 2))
await browser.close()
