/**
 * Deep Firefox probe: frame context, service workers, CSP header multiplicity,
 * SecurityPolicyViolationEvent, and whether script-src 'none' appears.
 *
 * Usage: npx tsx scripts/probeFirefoxCspSource.mts [url]
 */
import { firefox } from 'playwright-core'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'https://garment-background-studio.vercel.app/'
const outDir = join('tmp-release-validation', 'browser-compat')
mkdirSync(outDir, { recursive: true })
const profileDir = mkdtempSync(join(tmpdir(), 'ff-csp-'))

const browser = await firefox.launchPersistentContext(profileDir, {
  headless: true,
  // Fresh profile — no extensions.
})

const page = await browser.newPage()
const consoleMsgs: Array<{ type: string; text: string }> = []
const pageErrors: string[] = []
const cspHeaderOccurrences: Array<{ url: string; values: string[] }> = []

page.on('console', (msg) => {
  consoleMsgs.push({ type: msg.type(), text: msg.text() })
})
page.on('pageerror', (err) => {
  pageErrors.push(err.message)
})

await page.addInitScript(() => {
  const w = window as unknown as { __cspViolations?: unknown[] }
  w.__cspViolations = []
  document.addEventListener('securitypolicyviolation', (e) => {
    w.__cspViolations!.push({
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

page.on('response', async (res) => {
  // Firefox/Juggler may omit headersArray(); fall back to headers().
  const raw = typeof res.headersArray === 'function' ? res.headersArray() : null
  const list = Array.isArray(raw)
    ? raw
    : Object.entries(res.headers()).map(([name, value]) => ({ name, value }))
  const cspValues = list
    .filter((h) => h.name.toLowerCase() === 'content-security-policy')
    .map((h) => h.value)
  const reportOnly = list
    .filter(
      (h) => h.name.toLowerCase() === 'content-security-policy-report-only',
    )
    .map((h) => h.value)
  if (cspValues.length || reportOnly.length) {
    cspHeaderOccurrences.push({
      url: res.url(),
      values: [
        ...cspValues.map((v) => `enforce:${v}`),
        ...reportOnly.map((v) => `report-only:${v}`),
      ],
    })
  }
})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForSelector('#root > *', { timeout: 30_000 }).catch(() => null)
await page.waitForTimeout(2000)

const diagnosis = await page.evaluate(async () => {
  const w = window as unknown as { __cspViolations?: unknown[] }
  const regs =
    'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistrations()
      : []
  const cachesNames =
    'caches' in window ? await caches.keys() : ([] as string[])

  return {
    href: location.href,
    origin: location.origin,
    isTopFrame: window.top === window.self,
    frameElement: window.frameElement
      ? {
          tag: window.frameElement.tagName,
          sandbox: window.frameElement.getAttribute('sandbox'),
          src: (window.frameElement as HTMLIFrameElement).src,
        }
      : null,
    referrer: document.referrer,
    metaCsp: [...document.querySelectorAll('meta')].map((m) => ({
      httpEquiv: m.httpEquiv,
      name: m.getAttribute('name'),
      content: m.content?.slice(0, 300),
    })),
    scripts: [...document.scripts].map((s) => ({
      src: s.src,
      type: s.type,
      crossOrigin: s.crossOrigin,
      async: s.async,
      defer: s.defer,
    })),
    rootChildren: document.getElementById('root')?.childElementCount ?? -1,
    hasHeading: !!document.querySelector('h1'),
    title: document.title,
    cspViolations: w.__cspViolations ?? [],
    serviceWorkers: regs.map((r) => ({
      scope: r.scope,
      active: r.active?.scriptURL ?? null,
      waiting: r.waiting?.scriptURL ?? null,
    })),
    cacheNames: cachesNames,
  }
})

await page.screenshot({
  path: join(outDir, 'firefox-csp-source-probe.png'),
  fullPage: true,
})

const result = {
  url,
  profileDir,
  diagnosis,
  consoleMsgs,
  pageErrors,
  cspHeaderOccurrences: cspHeaderOccurrences.filter(
    (e) =>
      e.url === url ||
      e.url.replace(/\/$/, '') === url.replace(/\/$/, '') ||
      /\/assets\/index-.*\.(js|css)$/.test(e.url),
  ),
  consoleMentionsScriptSrcNone: consoleMsgs.some((m) =>
    /script-src\s+'none'|script-src none/i.test(m.text),
  ),
}

writeFileSync(
  join(outDir, 'firefox-csp-source-probe.json'),
  JSON.stringify(result, null, 2),
)
console.log(JSON.stringify(result, null, 2))
await browser.close()
