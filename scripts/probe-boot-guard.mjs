/**
 * Verify production serves boot-guard.js and the SPA mounts past the fallback.
 */
import { chromium } from 'playwright-core'

const origin =
  process.env.PROBE_URL || 'https://garment-background-studio.vercel.app'

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

const report = { origin, bootGuardStatus: null, appMounted: false, title: null }

const bootRes = await fetch(`${origin.replace(/\/$/, '')}/boot-guard.js`)
report.bootGuardStatus = bootRes.status
report.bootGuardHasVpnRedirect = /198\.18/.test(await bootRes.text())

const browser = await launch()
const page = await browser.newPage()
try {
  await page.goto(origin, { waitUntil: 'networkidle', timeout: 45000 })
  // Production must leave the static fallback.
  report.appMounted = await page
    .getByRole('heading', { name: 'Garment Background Studio' })
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  report.stillOnFallback = await page
    .getByTestId('boot-static-fallback')
    .isVisible()
    .catch(() => false)
  report.title = await page.title()

  // Simulate VPN-host classification (same rules as boot-guard.js).
  report.redirectWouldFire = await page.evaluate(() => {
    const host = '198.18.2.28'
    const m = /^(\d{1,3})\.(\d{1,3})\./.exec(host)
    const a = +m[1]
    const b = +m[2]
    return a === 198 && (b === 18 || b === 19)
  })
} catch (err) {
  report.error = err instanceof Error ? err.message : String(err)
} finally {
  await browser.close()
}

console.log(JSON.stringify(report, null, 2))
if (report.bootGuardStatus !== 200 || !report.appMounted || !report.redirectWouldFire) {
  process.exit(2)
}
