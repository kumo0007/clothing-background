/**
 * Compare production CSP as seen by Playwright Firefox with/without
 * respecting OS proxy settings (Firefox normally uses system proxy;
 * headless Playwright often does not).
 */
import { firefox } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2] ?? 'https://garment-background-studio.vercel.app/'
const outDir = join('tmp-release-validation', 'browser-compat')
mkdirSync(outDir, { recursive: true })

async function probe(label: string, launchOpts: Record<string, unknown>) {
  const browser = await firefox.launch({ headless: true, ...launchOpts })
  const page = await browser.newPage()
  const consoleMsgs: string[] = []
  const docCsps: string[] = []
  page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`))
  page.on('response', (res) => {
    if (res.url().replace(/\/$/, '') !== url.replace(/\/$/, '')) return
    const h = res.headers()
    for (const [k, v] of Object.entries(h)) {
      if (k.toLowerCase() === 'content-security-policy') docCsps.push(v)
    }
  })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(2500)
  const diag = await page.evaluate(() => ({
    href: location.href,
    isTop: window.top === window.self,
    fallback: !!document.getElementById('boot-static-fallback'),
    heading: document.querySelector('h1')?.textContent ?? null,
    rootChildren: document.getElementById('root')?.childElementCount ?? -1,
  }))
  await page.screenshot({
    path: join(outDir, `firefox-proxy-${label}.png`),
    fullPage: true,
  })
  await browser.close()
  return {
    label,
    docCsps,
    diag,
    consoleMsgs,
    mentionsNone: consoleMsgs.some((m) => /script-src ['"]?none['"]?/i.test(m)),
    loadingFailed: consoleMsgs.some((m) =>
      /Loading failed for the module/i.test(m),
    ),
  }
}

const results = {
  url,
  // Default Playwright (typically ignores system proxy)
  defaultLaunch: await probe('default', {}),
  // Ask Firefox to use system proxy settings
  systemProxy: await probe('system-proxy', {
    firefoxUserPrefs: {
      'network.proxy.type': 5, // use system proxy
    },
  }),
  // Explicitly disable proxy
  noProxy: await probe('no-proxy', {
    firefoxUserPrefs: {
      'network.proxy.type': 0,
    },
  }),
}

writeFileSync(
  join(outDir, 'firefox-proxy-csp-compare.json'),
  JSON.stringify(results, null, 2),
)
console.log(JSON.stringify(results, null, 2))
