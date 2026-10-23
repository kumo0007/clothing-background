const fs = require('fs')
const path = require('path')
const jpeg = require('jpeg-js')

async function ready() {
  const cv = require('@techstark/opencv-js')
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 60000)
    const done = () => {
      clearTimeout(t)
      resolve(cv)
    }
    if (typeof cv.Mat === 'function') done()
    else
      cv.then(
        () => done(),
        reject,
      )
    const start = Date.now()
    const poll = setInterval(() => {
      if (typeof cv.Mat === 'function') {
        clearInterval(poll)
        done()
      } else if (Date.now() - start > 55000) clearInterval(poll)
    }, 40)
  })
  return cv
}

function tryMode(cv, rgb, label, mode, rect) {
  const h = rgb.rows
  const w = rgb.cols
  const mask = new cv.Mat(h, w, cv.CV_8UC1)
  mask.setTo(new cv.Scalar(cv.GC_PR_BGD))
  // paint a center FG for mask mode
  if (mode === cv.GC_INIT_WITH_MASK) {
    const arr = new Uint8Array(h * w)
    arr.fill(cv.GC_PR_FGD)
    for (let x = 0; x < w; x++) {
      arr[x] = cv.GC_BGD
      arr[(h - 1) * w + x] = cv.GC_BGD
    }
    for (let y = 0; y < h; y++) {
      arr[y * w] = cv.GC_BGD
      arr[y * w + w - 1] = cv.GC_BGD
    }
    for (let y = 40; y < h - 40; y++) {
      for (let x = 40; x < w - 40; x++) arr[y * w + x] = cv.GC_PR_FGD
    }
    mask.data.set(arr)
  }
  const bgdModel = new cv.Mat(1, 65, cv.CV_32FC1)
  const fgdModel = new cv.Mat(1, 65, cv.CV_32FC1)
  bgdModel.data32F.fill(0)
  fgdModel.data32F.fill(0)
  const t0 = Date.now()
  try {
    cv.grabCut(rgb, mask, rect, bgdModel, fgdModel, 1, mode)
    let fg = 0
    for (let i = 0; i < mask.data.length; i++) {
      const v = mask.data[i]
      if (v === cv.GC_FGD || v === cv.GC_PR_FGD) fg++
    }
    console.log(label, 'OK', Date.now() - t0, 'ms fg=', fg)
  } catch (e) {
    console.log(label, 'FAIL', e && e.message ? e.message : e)
  }
  mask.delete()
  bgdModel.delete()
  fgdModel.delete()
}

ready()
  .then((cv) => {
    const raw = fs.readFileSync(
      path.join(__dirname, '../public/testdata/clothing/03_tshirt.jpg'),
    )
    const decoded = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
    // Downscale heavily for speed
    const rgba = cv.matFromImageData({
      width: decoded.width,
      height: decoded.height,
      data: decoded.data,
    })
    const rgbFull = new cv.Mat()
    cv.cvtColor(rgba, rgbFull, cv.COLOR_RGBA2RGB)
    const rgb = new cv.Mat()
    cv.resize(rgbFull, rgb, new cv.Size(160, 160), 0, 0, cv.INTER_AREA)
    console.log('work', rgb.cols, rgb.rows, 'type', rgb.type())

    const inset = new cv.Rect(10, 10, 140, 140)
    tryMode(cv, rgb, 'INIT_WITH_RECT iters1', cv.GC_INIT_WITH_RECT, inset)
    tryMode(cv, rgb, 'INIT_WITH_MASK iters1', cv.GC_INIT_WITH_MASK, inset)
    tryMode(cv, rgb, 'INIT_WITH_MASK fullrect', cv.GC_INIT_WITH_MASK, new cv.Rect(0, 0, 160, 160))

    rgba.delete()
    rgbFull.delete()
    rgb.delete()
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
