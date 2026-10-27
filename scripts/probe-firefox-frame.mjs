/**
 * Prove production no longer sends frame-ancestors 'none' / X-Frame-Options: DENY,
 * and that an iframe can load the app (Firefox RDM / mobile embed path).
 */
import { chromium } from 'playwright-core'

const target =
  process.env.PROBE_URL || 'https://garment-background-studio.vercel.app/'

async function launch() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' })
  } catch {
    return chromium.launch({
      headless: true,
      executablePath:
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    })
  }
}

const res = await fetch(target, { redirect: 'follow' })
const headers = {
  status: res.status,
  csp: res.headers.get('content-security-policy'),
  xfo: res.headers.get('x-frame-options'),
}

const report = {
  url: target,
  headers,
  blocksFirefoxFrame:
    /frame-ancestors\s+'none'/i.test(headers.csp || '') ||
    /deny/i.test(headers.xfo || ''),
  iframeLoaded: false,
  iframeTitle: null,
  iframeError: null,
}

if (report.blocksFirefoxFrame) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(2)
}

const browser = await launch()
const page = await browser.newPage()
try {
  await page.setContent(
    `<!doctype html><html><body>
      <iframe id="app" src="${target}" style="width:100%;height:100vh;border:0"></iframe>
    </body></html>`,
    { waitUntil: 'domcontentloaded' },
  )
  const frame = page.frameLocator('#app')
  await frame.locator('body').waitFor({ timeout: 20000 })
  // Either the app root or the boot fallback proves the document painted.
  const hasApp = await frame
    .locator('h1, [data-testid="image-file-input"], [data-testid="boot-static-fallback"]')
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  report.iframeLoaded = hasApp
  report.iframeTitle = await frame.locator('h1').first().textContent().catch(() => null)
} catch (err) {
  report.iframeError = err instanceof Error ? err.message : String(err)
} finally {
  await browser.close()
}

console.log(JSON.stringify(report, null, 2))
if (!report.iframeLoaded) process.exit(3)
