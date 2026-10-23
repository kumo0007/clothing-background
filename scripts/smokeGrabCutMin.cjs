const fs = require('fs')
const path = require('path')
const jpeg = require('jpeg-js')

const cv = require('@techstark/opencv-js')

function waitCv() {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 60000)
    const done = () => {
      clearTimeout(t)
      resolve()
    }
    if (typeof cv.Mat === 'function') done()
    else if (typeof cv.then === 'function') {
      cv.then(done, reject)
      const s = Date.now()
      const i = setInterval(() => {
        if (typeof cv.Mat === 'function') {
          clearInterval(i)
          done()
        } else if (Date.now() - s > 55000) clearInterval(i)
      }, 40)
    } else reject(new Error('bad module'))
  })
}

waitCv()
  .then(() => {
    console.log('ready')
    const raw = fs.readFileSync(
      path.join(__dirname, '../public/testdata/clothing/03_tshirt.jpg'),
    )
    const decoded = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
    const rgba = cv.matFromImageData({
      width: decoded.width,
      height: decoded.height,
      data: decoded.data,
    })
    const rgbFull = new cv.Mat()
    cv.cvtColor(rgba, rgbFull, cv.COLOR_RGBA2RGB)
    const rgb = new cv.Mat()
    // Small for speed
    cv.resize(rgbFull, rgb, new cv.Size(120, 120), 0, 0, cv.INTER_LINEAR)
    console.log('rgb', rgb.cols, rgb.rows)

    const mask = new cv.Mat(120, 120, cv.CV_8UC1)
    // Fill PR_BGD via data
    mask.data.fill(cv.GC_PR_BGD)

    const bgdModel = new cv.Mat(1, 65, cv.CV_64FC1)
    const fgdModel = new cv.Mat(1, 65, cv.CV_64FC1)
    bgdModel.data64F.fill(0)
    fgdModel.data64F.fill(0)

    const rect = new cv.Rect(15, 15, 90, 90)
    console.log('calling grabCut INIT_WITH_RECT…')
    const t0 = Date.now()
    try {
      cv.grabCut(rgb, mask, rect, bgdModel, fgdModel, 1, cv.GC_INIT_WITH_RECT)
      console.log('OK in', Date.now() - t0, 'ms')
      let fg = 0
      for (let i = 0; i < mask.data.length; i++) {
        if (mask.data[i] === cv.GC_FGD || mask.data[i] === cv.GC_PR_FGD) fg++
      }
      console.log('fg', fg)
    } catch (err) {
      console.log('FAIL type', typeof err, err)
      if (typeof cv.exceptionFromPtr === 'function') {
        try {
          console.log('exceptionFromPtr', cv.exceptionFromPtr(err))
        } catch (e2) {
          console.log('exceptionFromPtr failed', e2)
        }
      }
    }

    ;[rgba, rgbFull, rgb, mask, bgdModel, fgdModel].forEach((m) => {
      try {
        m.delete()
      } catch (_) {}
    })
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
