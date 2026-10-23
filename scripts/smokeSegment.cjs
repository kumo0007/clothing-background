/**
 * CJS smoke — avoids vite-node OpenCV init issues.
 * node scripts/smokeSegment.cjs [fixture.jpg]
 */
const fs = require('fs')
const path = require('path')
const jpeg = require('jpeg-js')

const root = path.join(__dirname, '..')
const file = process.argv[2] || '08_sneakers.jpg'

async function main() {
  // Load OpenCV first
  const cv = require('@techstark/opencv-js')
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('opencv timeout')), 120000)
    const done = () => {
      clearTimeout(t)
      resolve()
    }
    if (typeof cv.Mat === 'function') done()
    else if (typeof cv.then === 'function') {
      cv.then(() => done(), reject)
      const start = Date.now()
      const poll = setInterval(() => {
        if (typeof cv.Mat === 'function') {
          clearInterval(poll)
          done()
        } else if (Date.now() - start > 110000) clearInterval(poll)
      }, 50)
    } else reject(new Error('no Mat/then'))
  })
  console.log('OpenCV ready, grabCut=', typeof cv.grabCut)

  // Dynamic import of TS pipeline via vite-node is awkward from CJS —
  // instead exercise GrabCut directly on the fixture.
  const raw = fs.readFileSync(path.join(root, 'public/testdata/clothing', file))
  const decoded = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
  const { width, height, data } = decoded
  console.log('fixture', file, width, 'x', height)

  const rgba = cv.matFromImageData({ width, height, data })
  const rgb = new cv.Mat()
  cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB)

  const maxSide = 512
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const ww = Math.round(width * scale)
  const wh = Math.round(height * scale)
  let work = rgb
  if (scale < 1) {
    work = new cv.Mat()
    cv.resize(rgb, work, new cv.Size(ww, wh), 0, 0, cv.INTER_LINEAR)
  }

  // Init mask: border BGD, interior PR_FGD
  const maskArr = new Uint8Array(ww * wh)
  maskArr.fill(cv.GC_PR_FGD)
  for (let x = 0; x < ww; x++) {
    maskArr[x] = cv.GC_BGD
    maskArr[(wh - 1) * ww + x] = cv.GC_BGD
  }
  for (let y = 0; y < wh; y++) {
    maskArr[y * ww] = cv.GC_BGD
    maskArr[y * ww + ww - 1] = cv.GC_BGD
  }
  // Center hard FG
  const cx = (ww / 2) | 0
  const cy = (wh / 2) | 0
  for (let y = cy - 20; y < cy + 20; y++) {
    for (let x = cx - 20; x < cx + 20; x++) {
      if (x >= 0 && y >= 0 && x < ww && y < wh) maskArr[y * ww + x] = cv.GC_FGD
    }
  }

  const mask = cv.matFromArray(wh, ww, cv.CV_8UC1, maskArr)
  const bgdModel = new cv.Mat(1, 65, cv.CV_32FC1)
  const fgdModel = new cv.Mat(1, 65, cv.CV_32FC1)
  bgdModel.data32F.fill(0)
  fgdModel.data32F.fill(0)

  console.log('models', !!bgdModel.data32F, bgdModel.data32F && bgdModel.data32F.length)
  console.log('mask labels sample', mask.data[0], mask.data[(wh >> 1) * ww + (ww >> 1)])

  const t0 = Date.now()
  try {
    cv.grabCut(
      work,
      mask,
      new cv.Rect(0, 0, ww, wh),
      bgdModel,
      fgdModel,
      3,
      cv.GC_INIT_WITH_MASK,
    )
    console.log('grabCut ok in', Date.now() - t0, 'ms')
  } catch (err) {
    console.error('grabCut threw:', err && err.message ? err.message : err)
    console.error(err)
    process.exitCode = 1
  }

  let fg = 0
  for (let i = 0; i < mask.data.length; i++) {
    const v = mask.data[i]
    if (v === cv.GC_FGD || v === cv.GC_PR_FGD) fg++
  }
  console.log('fg pixels', fg, '/', ww * wh)

  ;[rgba, rgb, work !== rgb ? work : null, mask, bgdModel, fgdModel].forEach((m) => {
    if (m)
      try {
        m.delete()
      } catch (_) {}
  })
}

main().catch((e) => {
  console.error('fatal', e && e.stack ? e.stack : e)
  process.exit(1)
})
