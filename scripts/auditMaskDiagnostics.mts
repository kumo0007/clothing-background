/**
 * Structured mask-diagnostics audit.
 * Distinguishes Lab-seed proxy silhouettes from notes about live RMBG.
 * Detection only — never mutates masks. Writes JSON + Markdown.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import jpeg from 'jpeg-js'
import { segmentImageLocally } from '../src/lib/mask/localSegment.ts'
import { runMaskDiagnostics } from '../src/lib/mask/diagnostics/runMaskDiagnostics.ts'
import { analyzeKeepComponents } from '../src/lib/mask/diagnostics/fragmentation.ts'
import { reviewSdkMask } from '../src/lib/mask/sdkMaskReview.ts'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'tmp-mask-diagnostics-audit')
mkdirSync(outDir, { recursive: true })

const fixtures = [
  '01_hoodie.jpg',
  '02_blazer.jpg',
  '03_tshirt.jpg',
  '04_jeans.jpg',
  '05_coat.jpg',
  '06_sweater.jpg',
  '07_dress.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
  '10_cap.jpg',
]

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

const reports: unknown[] = []
const md: string[] = [
  '# Mask diagnostics audit',
  '',
  '**Silhouette source: Lab-seed proxy** (`opencv-seed-fallback`).',
  'This is **not** proof of live RMBG-1.4 quality. Fragmentation metrics below',
  'explain raw vs significant component counts.',
  '',
  '| Fixture | neural review | top rule | measured | unit | raw comps | noise | significant | main% | detached% |',
  '|---|---|---|---|---|---|---|---|---|---|',
]

for (const name of fixtures) {
  const abs = resolve(root, 'public/testdata/clothing', name)
  if (!existsSync(abs)) continue
  const image = decode(abs)
  const seg = await segmentImageLocally(image, { tolerance: 40 })
  const mask = {
    width: seg.mask.width,
    height: seg.mask.height,
    data: new Uint8ClampedArray(seg.mask.data),
  }
  const classical = runMaskDiagnostics({
    mask,
    imageData: image,
    profile: 'classical',
    method: seg.methodUsed,
  })
  const neural = runMaskDiagnostics({
    mask: {
      width: mask.width,
      height: mask.height,
      data: new Uint8ClampedArray(mask.data),
    },
    imageData: image,
    profile: 'neural',
    method: 'bg-remove-sdk-rmbg1.4 (Lab-seed proxy silhouette)',
  })
  const sdkReview = reviewSdkMask(
    {
      width: mask.width,
      height: mask.height,
      data: new Uint8ClampedArray(mask.data),
    },
    image,
    { resized: false, method: 'bg-remove-sdk-rmbg1.4 (proxy)' },
  )
  const frag = analyzeKeepComponents(mask)
  const top =
    neural.findings.find((f) => f.forcesReview) ?? neural.findings[0]

  reports.push({
    fixture: basename(name),
    silhouetteSource: 'lab-seed-proxy',
    notLiveRmbg: true,
    method: seg.methodUsed,
    classical,
    neural,
    sdkReview,
    fragmentation: frag.summary,
  })

  md.push(
    `| ${basename(name)} | ${neural.needsReview} | ${top?.ruleId ?? '—'} | ${top ? top.measuredValue.toFixed(3) : '—'} | ${(top?.unit ?? '—').slice(0, 40)} | ${frag.summary.totalComponents} | ${frag.summary.noiseComponents} | ${frag.summary.significantComponents} | ${(frag.summary.largestAreaShare * 100).toFixed(0)} | ${(frag.summary.detachedSignificantAreaShare * 100).toFixed(1)} |`,
  )
}

md.push('')
md.push('## Metric definitions')
md.push('')
md.push('- **raw comps**: all 4-connected KEEP islands (alpha≥128), including 1px dust.')
md.push('- **noise**: components smaller than `max(8, 0.004% of image pixels)`.')
md.push('- **significant**: non-noise components (detail + major).')
md.push('- **main%**: largest significant component / total KEEP.')
md.push('- **detached%**: KEEP mass outside the main significant component.')
md.push('- **`fragmented_keep` measuredValue**: detached area share / major count / detached significant count — **never** raw island count.')
md.push('- **heuristic score**: risk heuristic 0–1, **not** RMBG model confidence.')
md.push('')

const jsonPath = resolve(outDir, 'report.json')
writeFileSync(jsonPath, JSON.stringify(reports, null, 2))
md.push(`Wrote \`${jsonPath}\``)
const report = md.join('\n')
writeFileSync(resolve(outDir, 'REPORT.md'), report)
console.log(report)
