/**
 * Top-level Firefox production smoke: UI render + file upload only.
 * Auto-mask is separate (model download); gated behind --mask.
 */
import { firefox } from 'playwright-core'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const production =
  process.argv.find((a) => a.startsWith('http')) ??
  'https://garment-background-studio.vercel.app/'
const runMask = process.argv.includes('--mask')
const outDir = join('tmp-release-validation', 'browser-compat')
mkdirSync(outDir, { recursive: true })

const fixtureCandidates = [
  join('tmp-release-validation', '07_slip_dress.jpg'),
  join('public', 'samples', 'sample.jpg'),
]
const fixture = fixtureCandidates.find((p) => existsSync(p))

const browser = await firefox.launch({ headless: true })
const page = await browser.newPage()
const consoleMsgs: string[] = []
page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`))

const docCsps: string[] = []
page.on('response', (res) => {
  if (res.request().resourceType() !== 'document') return
  if (!res.url().startsWith(production.replace(/\/$/, ''))) return
  const csp = res.headers()['content-security-policy']
  if (csp) docCsps.push(csp)
})

await page.goto(production, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForSelector('h1', { timeout: 30_000 })
await page.waitForSelector('#boot-static-fallback', {
  state: 'detached',
  timeout: 15_000,
}).catch(() => null)

const rendered = await page.evaluate(() => ({
  fallback: !!document.getElementById('boot-static-fallback'),
  heading: document.querySelector('h1')?.textContent ?? null,
  upload: !!document.querySelector('input[type=file], [aria-label*="Upload" i]'),
}))

let upload: Record<string, unknown> = { skipped: true }
if (fixture) {
  const input = page.locator('input[type="file"]')
  await input.setInputFiles(fixture)
  await page.waitForTimeout(2000)
  upload = await page.evaluate(() => {
    const text = document.body.innerText
    return {
      bodyMentionsUploaded: /\d+\s+image/i.test(text) || /uploaded/i.test(text),
      noImagesYet: /No images uploaded yet/i.test(text),
      snippet: text.slice(0, 400),
    }
  })
  await page.screenshot({
    path: join(outDir, 'firefox-production-upload-smoke.png'),
    fullPage: true,
  })
}

let mask: Record<string, unknown> = { skipped: !runMask }
if (runMask && fixture) {
  const auto = page.getByRole('button', { name: /auto-mask/i })
  if (await auto.count()) {
    await auto.first().click()
    await page.waitForTimeout(5000)
    mask = {
      clicked: true,
      bodySnippet: (await page.innerText('body')).slice(0, 500),
    }
  } else {
    mask = { clicked: false, reason: 'no Auto-mask button found' }
  }
}

const result = {
  production,
  fixture: fixture ?? null,
  docCsps,
  rendered,
  upload,
  mask,
  consoleMentionsScriptSrcNone: consoleMsgs.some((m) =>
    /script-src ['"]?none['"]?/i.test(m),
  ),
  consoleMsgs: consoleMsgs.slice(0, 30),
  ok:
    rendered.fallback === false &&
    !!rendered.heading &&
    !consoleMsgs.some((m) => /script-src ['"]?none['"]?/i.test(m)) &&
    docCsps.every((c) => /script-src[^;]*'self'/i.test(c)) &&
    !docCsps.some((c) => /script-src\s+'none'/i.test(c)),
}

writeFileSync(
  join(outDir, 'firefox-production-upload-smoke.json'),
  JSON.stringify(result, null, 2),
)
console.log(JSON.stringify(result, null, 2))
await browser.close()
