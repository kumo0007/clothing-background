import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const img = path.join(root, 'public/testdata/clothing/07_slip_dress.jpg')
const outDir = __dirname
fs.mkdirSync(outDir, { recursive: true })

function overflowCheckScript() {
  return () => {
    const doc = document.documentElement
    const body = document.body
    const panel = document.querySelector('[data-testid="batch-panel"]')
    const stats = panel?.querySelector('.batch-panel__stats')
    const row = panel?.querySelector('.batch-panel__row')
    const buttons = [...(panel?.querySelectorAll('.batch-panel__row .button') ?? [])]
    const statsChips = [...(panel?.querySelectorAll('.batch-panel__stat') ?? [])]
    const hint = panel?.querySelector('.batch-panel__hint')
    const progress = document.querySelector('[data-testid="batch-progress"]')
    const vw = window.innerWidth
    const overflows = []
    const check = (el, name) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 || r.left < -1) {
        overflows.push({
          name,
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        })
      }
    }
    check(doc, 'html')
    check(body, 'body')
    check(panel, 'batch-panel')
    check(stats, 'stats')
    check(row, 'masking-row')
    check(hint, 'hint')
    buttons.forEach((b, i) =>
      check(b, `btn-${i}:${(b.textContent || '').trim().slice(0, 24)}`),
    )
    statsChips.forEach((c, i) =>
      check(c, `stat-${i}:${(c.textContent || '').trim().slice(0, 24)}`),
    )
    return {
      viewport: vw,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      hasHorizontalScroll:
        doc.scrollWidth > doc.clientWidth + 1 ||
        body.scrollWidth > body.clientWidth + 1,
      progressPresent: !!progress,
      statsCount: statsChips.length,
      buttonTexts: buttons.map((b) => (b.textContent || '').trim()),
      overflows,
      panelTextSample: (panel?.textContent || '').replace(/\s+/g, ' ').slice(0, 280),
    }
  }
}

const browser = await chromium
  .launch({ channel: 'chrome', headless: true })
  .catch(() => chromium.launch({ headless: true }))

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
})
const page = await context.newPage()
await page.goto('http://127.0.0.1:5173/', {
  waitUntil: 'networkidle',
  timeout: 60000,
})

const input = page.locator('[data-testid="image-uploader"] input[type="file"]')
await input.setInputFiles([img, img, img])
await page.waitForSelector('[data-testid="batch-panel"]', { timeout: 30000 })
await page.waitForTimeout(500)

const metrics390 = await page.evaluate(overflowCheckScript())
await page.screenshot({
  path: path.join(outDir, 'iphone-390-batch.png'),
  fullPage: true,
})

await page.setViewportSize({ width: 320, height: 568 })
await page.waitForTimeout(300)
const metrics320 = await page.evaluate(overflowCheckScript())
await page.screenshot({
  path: path.join(outDir, 'iphone-320-batch.png'),
  fullPage: true,
})

console.log(JSON.stringify({ metrics390, metrics320 }, null, 2))
await browser.close()
