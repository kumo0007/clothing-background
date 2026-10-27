import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = __dirname

const browser = await chromium
  .launch({ channel: 'chrome', headless: true })
  .catch(() => chromium.launch({ headless: true }))

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})
const page = await context.newPage()
await page.goto('http://127.0.0.1:5173/tmp-iphone-responsive/busy-fixture.html', {
  waitUntil: 'networkidle',
  timeout: 30000,
})

const metrics = await page.evaluate(() => {
  const vw = window.innerWidth
  const doc = document.documentElement
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
      })
    }
  }
  document
    .querySelectorAll(
      '.batch-panel, .batch-panel__stats, .batch-panel__stat, .batch-panel__row, .batch-panel__row .button, .batch-panel__hint',
    )
    .forEach((el, i) => {
      const label =
        el.className?.toString?.().split(/\s+/)[0] || el.tagName
      check(el, `${label}-${i}`)
    })
  return {
    viewport: vw,
    hasHorizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
    docScrollWidth: doc.scrollWidth,
    overflows,
    statsGrid: getComputedStyle(
      document.querySelector('.batch-panel__stats'),
    ).gridTemplateColumns,
  }
})

await page.screenshot({
  path: path.join(outDir, 'iphone-390-busy.png'),
  fullPage: true,
})

await page.setViewportSize({ width: 320, height: 568 })
await page.waitForTimeout(200)
const metrics320 = await page.evaluate(() => {
  const vw = window.innerWidth
  const doc = document.documentElement
  const overflows = []
  document
    .querySelectorAll(
      '.batch-panel__stat, .batch-panel__row .button, .batch-panel__hint',
    )
    .forEach((el, i) => {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 || r.left < -1) {
        overflows.push({
          name: `${el.className}-${i}`,
          left: Math.round(r.left),
          right: Math.round(r.right),
        })
      }
    })
  return {
    viewport: vw,
    hasHorizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
    overflows,
    statsGrid: getComputedStyle(
      document.querySelector('.batch-panel__stats'),
    ).gridTemplateColumns,
  }
})
await page.screenshot({
  path: path.join(outDir, 'iphone-320-busy.png'),
  fullPage: true,
})

console.log(JSON.stringify({ metrics, metrics320 }, null, 2))
await browser.close()
