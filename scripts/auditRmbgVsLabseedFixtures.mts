/**
 * Compare Lab-seed proxy diagnostics for tee/sneakers (known classical flags)
 * vs documented live-RMBG behavior. Does NOT run WebGPU RMBG (browser-only).
 *
 * Live RMBG metrics should be captured with `?audit=1` + Auto-mask in a browser
 * (see RELEASE_BLOCKER_INVESTIGATION.md).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import jpeg from 'jpeg-js'
import { segmentImageLocally } from '../src/lib/mask/localSegment.ts'
import { runMaskDiagnostics } from '../src/lib/mask/diagnostics/runMaskDiagnostics.ts'
import { analyzeKeepComponents } from '../src/lib/mask/diagnostics/fragmentation.ts'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'tmp-release-validation')
mkdirSync(outDir, { recursive: true })

const fixtures = ['03_tshirt.jpg', '08_sneakers.jpg'] as const

function decode(path: string) {
  const buf = readFileSync(path)
  const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
    colorSpace: 'srgb' as const,
  } as ImageData
}

const rows: unknown[] = []

for (const name of fixtures) {
  const abs = resolve(root, 'public/testdata/clothing', name)
  if (!existsSync(abs)) {
    console.warn('missing', abs)
    continue
  }
  const image = decode(abs)
  const seg = await segmentImageLocally(image, { tolerance: 40 })
  const mask = {
    width: seg.mask.width,
    height: seg.mask.height,
    data: seg.mask.data,
  }
  const frag = analyzeKeepComponents(mask)
  const classical = runMaskDiagnostics({
    mask,
    imageData: image,
    profile: 'classical',
    method: seg.methodUsed,
  })
  const neuralOnLab = runMaskDiagnostics({
    mask,
    imageData: image,
    profile: 'neural',
    method: seg.methodUsed,
  })
  rows.push({
    fixture: name,
    silhouetteSource: 'lab-seed-proxy',
    size: `${image.width}x${image.height}`,
    keepPct: Number((classical.metrics.keepRatio * 100).toFixed(2)),
    borderStudioRatio: classical.metrics.borderStudioRatio,
    paleAmongKeep: classical.metrics.paleAmongKeep,
    fragmentation: frag.summary,
    classical: {
      needsReview: classical.needsReview,
      rules: classical.findings
        .filter((f) => f.forcesReview || f.severity !== 'info')
        .map((f) => ({
          ruleId: f.ruleId,
          measured: f.measuredValue,
          threshold: f.threshold,
          forcesReview: f.forcesReview,
        })),
    },
    neuralOnSameLabMask: {
      needsReview: neuralOnLab.needsReview,
      rules: neuralOnLab.findings
        .filter((f) => f.forcesReview || f.severity !== 'info')
        .map((f) => ({
          ruleId: f.ruleId,
          measured: f.measuredValue,
          threshold: f.threshold,
          forcesReview: f.forcesReview,
        })),
    },
    interpretation:
      'Lab-seed silhouettes often keep studio card / fragment sneakers. Live RMBG masks for these fixtures previously showed 0 review in browser audit — compare live metrics via ?audit=1 before changing neural thresholds.',
  })
}

const outPath = resolve(outDir, 'tee-sneaker-labseed-vs-neural.json')
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2))
console.log(JSON.stringify(rows, null, 2))
console.log('Wrote', outPath)
