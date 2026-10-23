/**
 * Probe which OpenCV.js APIs are actually present at runtime in this build.
 * Run: node --experimental-strip-types scripts/probeOpenCvApis.mts
 *   or: npx vite-node scripts/probeOpenCvApis.mts
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

type CvLike = Record<string, unknown> & {
  then?: (onFulfilled: (v: unknown) => void, onRejected?: (e: unknown) => void) => unknown
  Mat?: unknown
}

function loadCv(timeoutMs = 120_000): Promise<CvLike> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`OpenCV init timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
    const finish = (cv: CvLike) => {
      clearTimeout(timer)
      if (typeof cv.Mat !== 'function') {
        reject(new Error('OpenCV resolved but cv.Mat is missing'))
        return
      }
      resolve(cv)
    }
    try {
      const cv = require('@techstark/opencv-js') as CvLike
      if (typeof cv.Mat === 'function') {
        finish(cv)
        return
      }
      if (typeof cv.then === 'function') {
        cv.then(
          (ready) => finish(ready as CvLike),
          (err) => {
            clearTimeout(timer)
            reject(err)
          },
        )
        return
      }
      // Fallback: poll for Mat
      const start = Date.now()
      const poll = setInterval(() => {
        if (typeof cv.Mat === 'function') {
          clearInterval(poll)
          finish(cv)
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(poll)
          clearTimeout(timer)
          reject(new Error('OpenCV Mat never appeared'))
        }
      }, 50)
    } catch (err) {
      clearTimeout(timer)
      reject(err)
    }
  })
}

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
] as const

async function main() {
  console.log('Loading OpenCV.js…')
  const cv = await loadCv()
  console.log('OpenCV ready. Mat=', typeof cv.Mat)

  const runtimeReport: Record<string, string> = {}
  for (const k of KEYS) {
    runtimeReport[k] = typeof cv[k]
  }

  console.log('\n=== Runtime API availability ===')
  for (const [k, t] of Object.entries(runtimeReport)) {
    const ok = t !== 'undefined'
    console.log(`${ok ? 'YES' : 'NO '} ${k} (${t})`)
  }

  // Quick smoke: create/delete a Mat
  const Mat = cv.Mat as new (rows: number, cols: number, type: number) => { delete: () => void }
  const CV_8UC3 = cv.CV_8UC3 as number
  const m = new Mat(4, 4, CV_8UC3)
  m.delete()
  console.log('\nMat create/delete OK')

  const out = join(root, 'tmp-opencv-api-probe.json')
  writeFileSync(
    out,
    JSON.stringify(
      {
        probedAt: new Date().toISOString(),
        package: '@techstark/opencv-js@4.10.0-release.1',
        runtimeReport,
        grabCutAvailable: typeof cv.grabCut === 'function',
        connectedComponentsAvailable: typeof cv.connectedComponentsWithStats === 'function',
      },
      null,
      2,
    ),
  )
  console.log('Wrote', out)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
