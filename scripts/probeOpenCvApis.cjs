/**
 * CommonJS probe — set onRuntimeInitialized BEFORE require so we don't miss it.
 */
const fs = require('fs')
const path = require('path')

const KEYS = [
  'grabCut',
  'GC_BGD',
  'GC_FGD',
  'GC_PR_BGD',
  'GC_PR_FGD',
  'GC_INIT_WITH_MASK',
  'GC_INIT_WITH_RECT',
  'GC_EVAL',
  'connectedComponentsWithStats',
  'connectedComponents',
  'distanceTransform',
  'morphologyEx',
  'Canny',
  'floodFill',
  'cvtColor',
  'COLOR_RGBA2Lab',
  'COLOR_RGB2Lab',
  'COLOR_BGR2Lab',
  'COLOR_RGBA2RGB',
  'COLOR_RGB2RGBA',
  'COLOR_RGBA2BGR',
  'COLOR_BGR2RGB',
  'matFromImageData',
  'GaussianBlur',
  'findContours',
  'bilateralFilter',
  'pyrMeanShiftFiltering',
  'watershed',
  'threshold',
  'erode',
  'dilate',
  'resize',
  'Mat',
  'Size',
  'Rect',
  'CV_8UC1',
  'CV_8UC3',
  'CV_8UC4',
  'INTER_LINEAR',
  'MORPH_CLOSE',
  'MORPH_OPEN',
  'MORPH_ELLIPSE',
  'getStructuringElement',
  'RETR_EXTERNAL',
  'CHAIN_APPROX_SIMPLE',
]

// Minimal browser stubs some OpenCV builds expect
if (typeof global.document === 'undefined') {
  global.document = {
    getElementById: () => null,
    createElement: () => ({ getContext: () => null }),
  }
}
if (typeof global.window === 'undefined') {
  global.window = global
}
if (typeof global.HTMLCanvasElement === 'undefined') {
  global.HTMLCanvasElement = function HTMLCanvasElement() {}
}
if (typeof global.ImageData === 'undefined') {
  global.ImageData = function ImageData(data, w, h) {
    this.data = data
    this.width = w
    this.height = h
  }
}

const timeoutMs = 90_000
const timer = setTimeout(() => {
  console.error('TIMEOUT waiting for OpenCV runtime')
  process.exit(1)
}, timeoutMs)

console.log('Requiring opencv.js…')

// Hook Module before load if present
global.Module = global.Module || {}
const prevInit = global.Module.onRuntimeInitialized
global.Module.onRuntimeInitialized = function () {
  if (typeof prevInit === 'function') prevInit()
  console.log('Module.onRuntimeInitialized fired')
}

let cv
try {
  cv = require('@techstark/opencv-js')
} catch (err) {
  console.error('require failed', err)
  process.exit(1)
}

function report(ready) {
  clearTimeout(timer)
  console.log('OpenCV ready. Mat=', typeof ready.Mat)
  const runtimeReport = {}
  for (const k of KEYS) {
    runtimeReport[k] = typeof ready[k]
  }
  for (const [k, t] of Object.entries(runtimeReport)) {
    console.log(`${t !== 'undefined' ? 'YES' : 'NO '} ${k} (${t})`)
  }
  const out = path.join(__dirname, '..', 'tmp-opencv-api-probe.json')
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        probedAt: new Date().toISOString(),
        package: '@techstark/opencv-js@4.10.0-release.1',
        runtimeReport,
        grabCutAvailable: typeof ready.grabCut === 'function',
        connectedComponentsAvailable:
          typeof ready.connectedComponentsWithStats === 'function',
      },
      null,
      2,
    ),
  )
  console.log('Wrote', out)
  process.exit(0)
}

if (typeof cv.Mat === 'function') {
  report(cv)
} else if (typeof cv.then === 'function') {
  console.log('Awaiting cv.then…')
  cv.then(
    (ready) => report(ready || cv),
    (err) => {
      console.error('cv.then rejected', err)
      process.exit(1)
    },
  )
  // Also poll — some builds resolve then() with undefined and mutate cv in place
  const start = Date.now()
  const poll = setInterval(() => {
    if (typeof cv.Mat === 'function') {
      clearInterval(poll)
      report(cv)
    } else if (Date.now() - start > timeoutMs - 1000) {
      clearInterval(poll)
    }
  }, 100)
} else {
  console.error('No Mat and no then — cannot init')
  process.exit(1)
}
