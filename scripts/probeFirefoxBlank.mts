/**
 * One-shot Firefox probe for blank-page diagnosis.
 * Usage: npx tsx scripts/probeFirefoxBlank.mts [url]
 */
import { firefox, chromium } from 'playwright-core'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2] ?? 'https://garment-background-studio.vercel.app/'
const outDir = join('tmp-release-validation', 'browser-compat')
mkdirSync(outDir, { recursive: true })

type ProbeResult = {
  browser: string
  url: string
  title: string
  rootChildCount: number
  rootTextSample: string
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: Array<{ url: string; status: number | null; failure: string | null }>
  hasAppHeading: boolean
}

async function probe(
  kind: 'firefox' | 'chromium',
): Promise<ProbeResult> {
  const browser =
    kind === 'firefox'
      ? await firefox.launch({ headless: true })
      : await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: ProbeResult['failedRequests'] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => {
    pageErrors.push(err.message)
  })
  page.on('requestfailed', (req) => {
    failedRequests.push({
      url: req.url(),
      status: null,
      failure: req.failure()?.errorText ?? 'requestfailed',
    })
  })
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push({
        url: res.url(),
        status: res.status(),
        failure: null,
      })
    }
  })

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
  // Allow React mount
  await page.waitForTimeout(2000)

  const shot = join(outDir, `${kind}-prod.png`)
  await page.screenshot({ path: shot, fullPage: true })

  const info = await page.evaluate(() => {
    const root = document.getElementById('root')
    const h1 = document.querySelector('h1')
    return {
      title: document.title,
      rootChildCount: root?.childElementCount ?? -1,
      rootTextSample: (root?.textContent ?? '').slice(0, 240),
      hasAppHeading: !!h1 && /Garment Background Studio/i.test(h1.textContent ?? ''),
    }
  })

  await browser.close()
  return {
    browser: kind,
    url,
    ...info,
    consoleErrors,
    pageErrors,
    failedRequests: failedRequests.slice(0, 30),
  }
}

const results: Record<string, ProbeResult | { error: string }> = {}
try {
  results.firefox = await probe('firefox')
} catch (err) {
  results.firefox = {
    error: err instanceof Error ? err.message : String(err),
  }
}
try {
  results.chromium = await probe('chromium')
} catch (err) {
  results.chromium = {
    error: err instanceof Error ? err.message : String(err),
  }
}
writeFileSync(
  join(outDir, 'probe-results.json'),
  JSON.stringify(results, null, 2),
)
console.log(JSON.stringify(results, null, 2))
if (
  results.firefox &&
  'error' in results.firefox &&
  typeof results.firefox.error === 'string'
) {
  process.exit(1)
}
