/**
 * Final segmentation quality audit.
 *
 * - Builds independent definite FG/BG/uncertain reference masks (NOT algo GT)
 * - Scores binary + boundary + hole metrics per fixture
 * - Records algorithm path (GrabCut vs seed-fallback) and timings
 * - Writes fresh magenta exports + JSON/Markdown report
 *
 * Run: npx vite-node scripts/auditSegmentationQuality.mts
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { compositePixelBuffers } from '../src/lib/rendering/compositePixels'
import { runAutoMaskPipeline } from '../src/lib/mask/autoMaskPipeline'
import {
  buildIndependentReferenceMask,
  summarizeReferenceCoverage,
  REF_FG,
  REF_BG,
  REF_UNCERTAIN,
} from '../src/lib/mask/audit/referenceMask'
import {
  computeBinaryMetrics,
  computeBoundaryMetrics,
  computeInternalHoleError,
} from '../src/lib/mask/audit/metrics'
import { tryLoadOpenCv } from '../src/lib/mask/opencv/loadOpenCv'
import { hasGrabCut } from '../src/lib/mask/opencv/cvTypes'
import { averageCornerColor } from '../src/lib/mask/selectSimilar'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clothingDir = join(root, 'public', 'testdata', 'clothing')
const outDir = join(root, 'tmp-quality-audit')

const FIXTURES = [
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
] as const

const HARD_CASES = new Set([
  '03_tshirt.jpg',
  '05_coat.jpg',
  '06_sweater.jpg',
  '07_dress.jpg',
  '08_sneakers.jpg',
  '09_handbag.jpg',
  '10_cap.jpg',
])

const MAGENTA: [number, number, number] = [255, 0, 255]

function decodeJpeg(path: string): ImageData {
  const raw = readFileSync(path)
  const decoded = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength,
    ),
    colorSpace: 'srgb',
  } as ImageData
}

function writePng(
  path: string,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
) {
  const png = new PNG({ width, height })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  writeFileSync(path, PNG.sync.write(png))
}

function maskToRgba(mask: Uint8ClampedArray, n: number, mode: 'gray' | 'ref') {
  const rgba = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i += 1) {
    const v = mask[i]!
    const o = i * 4
    if (mode === 'ref') {
      if (v === REF_FG) {
        rgba[o] = 0
        rgba[o + 1] = 220
        rgba[o + 2] = 80
      } else if (v === REF_BG) {
        rgba[o] = 40
        rgba[o + 1] = 40
        rgba[o + 2] = 40
      } else {
        rgba[o] = 180
        rgba[o + 1] = 140
        rgba[o + 2] = 40
      }
    } else {
      rgba[o] = v
      rgba[o + 1] = v
      rgba[o + 2] = v
    }
    rgba[o + 3] = 255
  }
  return rgba
}

function haloProxy(
  imageData: ImageData,
  mask: Uint8ClampedArray,
): { brightKeepEdge: number; ratio: number } {
  const corner = averageCornerColor(imageData)
  const studioLuma =
    0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const { width, height } = imageData
  let brightKeepEdge = 0
  let edge = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      if (mask[i]! < 128) continue
      const touchesRemove =
        mask[i - 1]! < 128 ||
        mask[i + 1]! < 128 ||
        mask[i - width]! < 128 ||
        mask[i + width]! < 128
      if (!touchesRemove) continue
      edge += 1
      const o = i * 4
      const r = imageData.data[o]!
      const g = imageData.data[o + 1]!
      const b = imageData.data[o + 2]!
      const L = 0.299 * r + 0.587 * g + 0.114 * b
      const c = Math.max(r, g, b) - Math.min(r, g, b)
      if (c <= 22 && L >= studioLuma - 8 && L >= 170) brightKeepEdge += 1
    }
  }
  return {
    brightKeepEdge,
    ratio: edge > 0 ? +(brightKeepEdge / edge).toFixed(4) : 0,
  }
}

function sourceRgbFingerprint(imageData: ImageData): string {
  // Sample corners + center to prove source RGB untouched after pipeline.
  const pts = [
    [0, 0],
    [imageData.width - 1, 0],
    [0, imageData.height - 1],
    [(imageData.width / 2) | 0, (imageData.height / 2) | 0],
  ] as const
  return pts
    .map(([x, y]) => {
      const o = (y * imageData.width + x) * 4
      return `${imageData.data[o]},${imageData.data[o + 1]},${imageData.data[o + 2]}`
    })
    .join('|')
}

mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, 'exports'), { recursive: true })
mkdirSync(join(outDir, 'reference'), { recursive: true })

const cv = await tryLoadOpenCv()
const runtimePath = {
  environment: typeof process !== 'undefined' && process.versions?.node
    ? 'node'
    : 'browser',
  openCvLoaded: Boolean(cv),
  grabCutApiPresent: cv ? hasGrabCut(cv) : false,
  note:
    'Under Vite/Node, GrabCut WASM often hangs or is skipped; methodUsed=opencv-seed-fallback is the documented Node path and is NOT evidence that GrabCut ran.',
}

type FixtureReport = {
  file: string
  hardCase: boolean
  width: number
  height: number
  methodUsed: string
  elapsedMs: number
  sourceRgbUnchanged: boolean
  reference: ReturnType<typeof summarizeReferenceCoverage>
  binary: ReturnType<typeof computeBinaryMetrics>
  boundary: ReturnType<typeof computeBoundaryMetrics>
  holes: ReturnType<typeof computeInternalHoleError>
  haloProxy: ReturnType<typeof haloProxy>
  rootCause: string
  remainingLimitations: string[]
  exportPaths: { result: string; mask: string; reference: string }
}

const reports: FixtureReport[] = []

for (const name of FIXTURES) {
  const imageData = decodeJpeg(join(clothingDir, name))
  const beforeFp = sourceRgbFingerprint(imageData)

  const result = await runAutoMaskPipeline(imageData, 'opencv')
  const afterFp = sourceRgbFingerprint(imageData)
  const sourceRgbUnchanged = beforeFp === afterFp

  const ref = buildIndependentReferenceMask(imageData)
  const coverage = summarizeReferenceCoverage(ref)
  const binary = computeBinaryMetrics(result.mask, ref)
  const boundary = computeBoundaryMetrics(result.mask, ref, 2)
  const holes = computeInternalHoleError(result.mask, ref, imageData)
  const halo = haloProxy(imageData, result.mask)

  const base = name.replace(/\.jpg$/i, '')
  const pixels = imageData.width * imageData.height
  const background = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4
    background[o] = MAGENTA[0]
    background[o + 1] = MAGENTA[1]
    background[o + 2] = MAGENTA[2]
    background[o + 3] = 255
  }
  const out = compositePixelBuffers(
    imageData.data,
    result.mask.data,
    background,
  )
  const resultPath = join(outDir, 'exports', `${base}-result.png`)
  const maskPath = join(outDir, 'exports', `${base}-mask.png`)
  const refPath = join(outDir, 'reference', `${base}-ref.png`)
  writePng(resultPath, imageData.width, imageData.height, out)
  writePng(
    maskPath,
    imageData.width,
    imageData.height,
    maskToRgba(result.mask.data, pixels, 'gray'),
  )
  writePng(
    refPath,
    imageData.width,
    imageData.height,
    maskToRgba(ref.data, pixels, 'ref'),
  )

  // Also refresh legacy quality-pass export dir for continuity.
  writePng(
    join(root, 'tmp-quality-pass-exports', `${base}-result.png`),
    imageData.width,
    imageData.height,
    out,
  )
  writePng(
    join(root, 'tmp-quality-pass-exports', `${base}-mask.png`),
    imageData.width,
    imageData.height,
    maskToRgba(result.mask.data, pixels, 'gray'),
  )

  const remainingLimitations: string[] = []
  let rootCause = 'Acceptable definite-label agreement on dark/chromatic mass.'

  if (name === '08_sneakers.jpg') {
    rootCause =
      'White/near-white leather vs studio card is Lab-ambiguous; definite FG covers dark soles/mesh only. Global Lab loosen would eat card.'
    remainingLimitations.push(
      'Significant white leather KEEP damage vs human intent — not production-ready for white-on-near-white without manual correction.',
      'Uncertain-region metrics cannot fully quantify leather loss.',
    )
  } else if (name === '09_handbag.jpg') {
    rootCause =
      'Handle openings are usually border-connected through the open top of the arches (not enclosed components), so stripEnclosed / stripDarkWalled skip them. Wall-adjacent JPEG variance also blocks flat-studio strip. Magenta exports still show retained studio under handles.'
    remainingLimitations.push(
      'Visible handle-interior studio remains — requires targeted open-arch background fill or manual edit, not blind enclosed-hole removal.',
      `Enclosed-hole proxy=${holes.internalHoleErrorPixels}px (under-counts open arches that touch exterior KEEP).`,
      'Thin strap AA and hardware fringes may need manual touch-up.',
      'Not safe to auto-remove all bright regions beside dark leather (hardware / leather details).',
    )
  } else if (name === '03_tshirt.jpg') {
    rootCause =
      'White tee vs near-white card: large uncertain band; border-connected studio may remain as bright KEEP fringe.'
    remainingLimitations.push(
      'White-on-near-white contamination not fully measurable as FG miss; visual halo/contamination remains.',
    )
  } else if (name === '06_sweater.jpg' || name === '05_coat.jpg') {
    rootCause =
      'Dark garment definite FG is strong; residual halos are soft-studio / AA on silhouette (scored partly via haloProxy + boundary).'
    if (halo.ratio > 0.08) {
      remainingLimitations.push(
        `Bright KEEP edge halo proxy ${(halo.ratio * 100).toFixed(1)}% of edge band.`,
      )
    }
  } else if (name === '07_dress.jpg') {
    rootCause =
      'Thin straps are definite dark FG when L is low; soft AA around straps and neckline may remain uncertain.'
    remainingLimitations.push(
      'Strap width at ~1–2px is fragile under aggressive peel.',
    )
  } else if (name === '10_cap.jpg') {
    rootCause =
      'Warm crown is definite FG; brim contact shadow is uncertain / mid-gray — may leave soft fringe.'
  }

  if (halo.ratio > 0.12) {
    remainingLimitations.push(
      'Visible silhouette contamination likely (haloProxy).',
    )
  }
  if ((binary.garmentMissRate ?? 0) > 0.08) {
    remainingLimitations.push(
      `Definite garment miss rate ${((binary.garmentMissRate ?? 0) * 100).toFixed(1)}%.`,
    )
  }
  if ((binary.bgContaminationRate ?? 0) > 0.05) {
    remainingLimitations.push(
      `Definite BG contamination ${((binary.bgContaminationRate ?? 0) * 100).toFixed(1)}%.`,
    )
  }

  const report: FixtureReport = {
    file: name,
    hardCase: HARD_CASES.has(name),
    width: imageData.width,
    height: imageData.height,
    methodUsed: result.methodUsed,
    elapsedMs: result.elapsedMs,
    sourceRgbUnchanged,
    reference: coverage,
    binary,
    boundary,
    holes,
    haloProxy: halo,
    rootCause,
    remainingLimitations,
    exportPaths: {
      result: resultPath,
      mask: maskPath,
      reference: refPath,
    },
  }
  reports.push(report)
  console.log(
    `${name}: method=${result.methodUsed} ${result.elapsedMs}ms iou=${binary.iou} dice=${binary.dice} halo=${halo.ratio} holes=${holes.internalHoleErrorPixels}`,
  )
}

const productionReady = !reports.some(
  (r) =>
    (r.binary.garmentMissRate ?? 0) > 0.12 ||
    (r.haloProxy.ratio > 0.15 && r.hardCase) ||
    r.holes.internalHoleErrorPixels > 80 ||
    r.remainingLimitations.some((s) =>
      /not production-ready|Significant white leather/i.test(s),
    ),
)

const summary = {
  generatedAt: new Date().toISOString(),
  runtimePath,
  productionReadyAutomaticSegmentation: productionReady,
  verdict: productionReady
    ? 'Metrics on definite labels look healthy; still verify visuals.'
    : 'NOT production-ready for fully automatic segmentation: significant white-on-near-white damage and/or visible contamination remain on hard fixtures.',
  referencePolicy: {
    type: 'independent-appearance-border',
    notGroundTruth: true,
    excludedFromBinaryScores: 'REF_UNCERTAIN (128)',
    unreliableMetrics: [
      'Full-image IoU/Dice treating algorithm mask as GT — never used',
      'Sneaker/tee white leather FG recall — largely UNCERTAIN',
      'Soft shadow true-positive rate without manual paint',
    ],
  },
  fixtures: reports,
}

writeFileSync(join(outDir, 'audit-report.json'), JSON.stringify(summary, null, 2))

const md: string[] = [
  '# Final Segmentation Quality Audit',
  '',
  `Generated: ${summary.generatedAt}`,
  '',
  `**Verdict:** ${summary.verdict}`,
  '',
  `Production-ready automatic segmentation: **${productionReady ? 'NO claim / see verdict' : 'NO'}**`,
  '',
  '## Runtime path',
  '',
  '```json',
  JSON.stringify(runtimePath, null, 2),
  '```',
  '',
  '## Reference policy',
  '',
  '- Independent definite FG/BG from appearance + border flood — **not** manual paint and **not** the algorithm mask.',
  '- Uncertain (pale near-card, soft shadow, white leather candidates) excluded from binary metrics.',
  '- Soft alpha MAE reported on definite FG edge band separately.',
  '',
  '## Per-fixture results',
  '',
]

for (const r of reports) {
  md.push(`### ${r.file}${r.hardCase ? ' (hard case)' : ''}`)
  md.push('')
  md.push(`- Method: \`${r.methodUsed}\` · ${r.elapsedMs} ms · source RGB unchanged: ${r.sourceRgbUnchanged}`)
  md.push(
    `- Reference coverage: FG=${r.reference.definiteFg} BG=${r.reference.definiteBg} uncertain=${r.reference.uncertain} (${(r.reference.uncertainRatio * 100).toFixed(1)}%)`,
  )
  md.push(
    `- Binary (definite only): FG P/R=${r.binary.fgPrecision}/${r.binary.fgRecall} · BG P/R=${r.binary.bgPrecision}/${r.binary.bgRecall} · IoU=${r.binary.iou} · Dice=${r.binary.dice}`,
  )
  md.push(
    `- Garment miss=${r.binary.garmentMissRate} · BG contamination=${r.binary.bgContaminationRate}`,
  )
  md.push(
    `- Boundary (tol=2): accuracy=${r.boundary.edgeAccuracy} · softAlphaMae=${r.boundary.softAlphaMae} · band=${r.boundary.edgeBandPixels}px`,
  )
  md.push(
    `- Internal hole proxy: ${r.holes.internalHoleErrorPixels}px / ${r.holes.internalHoleComponents} components`,
  )
  md.push(
    `- Halo proxy (bright KEEP on edge): ${r.haloProxy.brightKeepEdge}px (${(r.haloProxy.ratio * 100).toFixed(1)}% of edge)`,
  )
  md.push(`- Root cause: ${r.rootCause}`)
  if (r.remainingLimitations.length) {
    md.push(`- Remaining: ${r.remainingLimitations.join(' ')}`)
  }
  md.push(
    `- Exports: \`${r.exportPaths.result}\` · mask · ref \`${r.exportPaths.reference}\``,
  )
  md.push('')
}

md.push('## Acceptance checklist')
md.push('')
md.push('- [ ] 103+ unit tests pass (run separately)')
md.push('- [ ] typecheck + build pass')
md.push('- [ ] Fresh exports under `tmp-quality-audit/exports` and `tmp-quality-pass-exports`')
md.push('- [ ] Original source RGB unchanged (per-fixture flag above)')
md.push('- [ ] Node path recorded as seed-fallback when GrabCut WASM unavailable — not claimed as GrabCut success')
md.push('')

writeFileSync(join(outDir, 'AUDIT_REPORT.md'), md.join('\n'))

// Sync summary into quality-pass folder
copyFileSync(
  join(outDir, 'audit-report.json'),
  join(root, 'tmp-quality-pass-exports', 'audit-report.json'),
)

console.log('\n' + summary.verdict)
console.log(`Wrote ${outDir}/AUDIT_REPORT.md and audit-report.json`)
