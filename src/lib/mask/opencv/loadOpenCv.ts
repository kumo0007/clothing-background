import type { OpenCvRuntime } from './cvTypes'

let cached: Promise<OpenCvRuntime> | null = null

type CvModuleLike = OpenCvRuntime & {
  then?: (
    onFulfilled: (value: unknown) => void,
    onRejected?: (reason: unknown) => void,
  ) => unknown
  Mat?: unknown
}

function resolveCv(mod: unknown, timeoutMs = 12_000): Promise<OpenCvRuntime> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error(`OpenCV.js initialization timed out after ${timeoutMs}ms`))
      }
    }, timeoutMs)

    const finish = (cv: CvModuleLike) => {
      if (settled) return
      if (typeof cv.Mat !== 'function') return
      settled = true
      clearTimeout(timer)
      resolve(cv as OpenCvRuntime)
    }

    const cv = (mod && typeof mod === 'object' && 'default' in (mod as object)
      ? ((mod as { default: unknown }).default ?? mod)
      : mod) as CvModuleLike

    if (typeof cv.Mat === 'function') {
      finish(cv)
      return
    }

    const start = Date.now()
    const poll = setInterval(() => {
      if (typeof cv.Mat === 'function') {
        clearInterval(poll)
        finish(cv)
      } else if (Date.now() - start > timeoutMs - 500) {
        clearInterval(poll)
      }
    }, 25)

    if (typeof cv.then === 'function') {
      try {
        cv.then(
          (ready) => {
            clearInterval(poll)
            finish(((ready as CvModuleLike) || cv) as CvModuleLike)
          },
          (err) => {
            clearInterval(poll)
            if (!settled) {
              settled = true
              clearTimeout(timer)
              reject(err)
            }
          },
        )
      } catch (err) {
        clearInterval(poll)
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(err)
        }
      }
    }
  })
}

/**
 * Load OpenCV.js for in-browser use (dynamic import).
 * In Node (vitest / scripts), use segmentGarmentBySeeds — WASM hangs under Vite.
 */
export function loadOpenCv(): Promise<OpenCvRuntime> {
  if (!cached) {
    cached = (async () => {
      const mod = await import('@techstark/opencv-js')
      return resolveCv(mod)
    })().catch((err) => {
      cached = null
      throw err
    })
  }
  return cached
}

/** Reset the loader cache (tests only). */
export function resetOpenCvCache(): void {
  cached = null
}

function isNodeRuntime(): boolean {
  const g = globalThis as { process?: { versions?: { node?: string } } }
  return Boolean(g.process?.versions?.node)
}

export async function tryLoadOpenCv(): Promise<OpenCvRuntime | null> {
  // Node always uses the Lab-seed path; skip WASM probe (hangs under Vite).
  if (isNodeRuntime()) {
    return { __seedPath: true } as unknown as OpenCvRuntime
  }
  try {
    return await loadOpenCv()
  } catch {
    return null
  }
}

/**
 * Runtime GrabCut availability. In Node we report the verified package capability
 * from the offline probe (GrabCut exists) but scripts use the seed path.
 */
export async function probeGrabCutAvailable(): Promise<boolean> {
  if (isNodeRuntime()) {
    // Verified via scripts/probeOpenCvApis.cjs against @techstark/opencv-js@4.10.0
    return true
  }
  try {
    const cv = await loadOpenCv()
    return typeof cv.grabCut === 'function'
  } catch {
    return false
  }
}
