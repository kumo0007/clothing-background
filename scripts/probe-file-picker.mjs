/**
 * Probe whether Chromium opens a file chooser for the upload control.
 */
import { chromium } from 'playwright-core'

const target = process.env.PROBE_URL || 'http://127.0.0.1:5173/'

async function launch() {
  try {
    return await chromium.launch({
      headless: true,
      channel: 'chrome',
    })
  } catch {
    return chromium.launch({
      headless: true,
      executablePath:
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    })
  }
}

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const report = {
  url: target,
  attempts: [],
}

try {
  await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 })
  const input = page.locator('[data-testid="image-file-input"]')
  await input.waitFor({ state: 'visible', timeout: 15000 })

  report.geometry = await input.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      width: rect.width,
      height: rect.height,
      opacity: style.opacity,
      display: style.display,
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
      disabled: el.disabled,
      accept: el.accept,
    }
  })

  report.coveredBy = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="image-file-input"]')
    const rect = el.getBoundingClientRect()
    const x = rect.left + 30
    const y = rect.top + rect.height / 2
    const top = document.elementFromPoint(x, y)
    return top && (top === el || el.contains(top))
      ? null
      : top
        ? { tag: top.tagName, className: String(top.className || '') }
        : 'nothing'
  })

  async function attempt(name, action) {
    const entry = { name, opened: false, error: null }
    try {
      const chooserWait = page
        .waitForEvent('filechooser', { timeout: 4000 })
        .then(async (chooser) => {
          entry.opened = true
          await chooser.cancel()
        })
      await action()
      await chooserWait.catch(() => {})
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
    }
    report.attempts.push(entry)
  }

  await attempt('click-default', async () => {
    await input.click({ timeout: 3000 })
  })

  await attempt('click-force', async () => {
    await input.click({ force: true, timeout: 3000 })
  })

  await attempt('showPicker', async () => {
    await input.evaluate(async (el) => {
      if (typeof el.showPicker === 'function') {
        el.showPicker()
      } else {
        el.click()
      }
    })
  })

  await attempt('dispatch-trusted-click', async () => {
    await input.dispatchEvent('click')
  })

  // Upload path still works via Playwright file injection (no OS dialog).
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  await input.setInputFiles({
    name: 'probe.png',
    mimeType: 'image/png',
    buffer: png,
  })
  report.setInputFilesOk = await page
    .getByText(/1 image/i)
    .first()
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false)

  report.galleryEmptyGone = !(await page
    .getByTestId('gallery-empty')
    .isVisible()
    .catch(() => false))
} catch (err) {
  report.error = err instanceof Error ? err.message : String(err)
} finally {
  await browser.close()
}

console.log(JSON.stringify(report, null, 2))
const anyOpen = report.attempts?.some((a) => a.opened)
if (!anyOpen && !report.setInputFilesOk) process.exitCode = 2
if (!anyOpen) process.exitCode = process.exitCode || 3
