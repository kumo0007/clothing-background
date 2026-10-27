/**
 * Finalize / validate polo-carpet cutouts without changing BiRefNet or the pipeline.
 * Reads tmp-model-eval/polo-carpet-cutouts-2026-10-27/
 * Writes tmp-model-eval/polo-carpet-final-2026-10-27/ (does not overwrite prior artifacts).
 *
 * Run: npx tsx scripts/finalizePoloCarpetCutouts.mts
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = join(root, 'tmp-model-eval', 'polo-carpet-cutouts-2026-10-27')
const outRoot = join(root, 'tmp-model-eval', 'polo-carpet-final-2026-10-27')

const IDS = [
  'polo-1',
  'polo-2',
  'polo-3',
  'polo-4',
  'polo-5',
  'polo-6',
  'polo-8',
  'polo-7',
] as const

type Rgba = {
  width: number
  height: number
  data: Uint8ClampedArray
}

const BG = {
  white: [255, 255, 255] as [number, number, number],
  black: [0, 0, 0] as [number, number, number],
  magenta: [255, 0, 255] as [number, number, number],
  beige: [217, 196, 174] as [number, number, number],
}

function decodePng(path: string): Rgba {
  const png = PNG.sync.read(readFileSync(path))
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(
      png.data.buffer,
      png.data.byteOffset,
      png.data.byteLength,
    ),
  }
}

function decodeSource(path: string): Rgba {
  const buf = readFileSync(path)
  if (extname(path).toLowerCase() === '.png') return decodePng(path)
  const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength,
    ),
  }
}

function writePng(path: string, img: Rgba) {
  const png = new PNG({ width: img.width, height: img.height })
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength)
  writeFileSync(path, PNG.sync.write(png))
}

function grayToRgba(mask: Rgba): Rgba {
  // Mask PNGs are RGB with identical channels; use R as alpha proxy for viz.
  const out = new Uint8ClampedArray(mask.width * mask.height * 4)
  for (let i = 0; i < mask.width * mask.height; i += 1) {
    const v = mask.data[i * 4]!
    const o = i * 4
    out[o] = v
    out[o + 1] = v
    out[o + 2] = v
    out[o + 3] = 255
  }
  return { width: mask.width, height: mask.height, data: out }
}

function compositeOver(
  rgba: Rgba,
  rgb: [number, number, number],
): Rgba {
  const out = new Uint8ClampedArray(rgba.data.length)
  for (let i = 0; i < rgba.width * rgba.height; i += 1) {
    const o = i * 4
    const a = rgba.data[o + 3]! / 255
    out[o] = Math.round(rgba.data[o]! * a + rgb[0] * (1 - a))
    out[o + 1] = Math.round(rgba.data[o + 1]! * a + rgb[1] * (1 - a))
    out[o + 2] = Math.round(rgba.data[o + 2]! * a + rgb[2] * (1 - a))
    out[o + 3] = 255
  }
  return { width: rgba.width, height: rgba.height, data: out }
}

function sideBySide(panels: Rgba[], gap = 8): Rgba {
  const h = Math.max(...panels.map((p) => p.height))
  const w =
    panels.reduce((s, p) => s + p.width, 0) + gap * Math.max(0, panels.length - 1)
  const data = new Uint8ClampedArray(w * h * 4)
  // Neutral checker-ish dark fill
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4
    data[o] = 32
    data[o + 1] = 32
    data[o + 2] = 36
    data[o + 3] = 255
  }
  let x0 = 0
  for (const p of panels) {
    for (let y = 0; y < p.height; y += 1) {
      for (let x = 0; x < p.width; x += 1) {
        const si = (y * p.width + x) * 4
        const di = (y * w + (x0 + x)) * 4
        data[di] = p.data[si]!
        data[di + 1] = p.data[si + 1]!
        data[di + 2] = p.data[si + 2]!
        data[di + 3] = 255
      }
    }
    x0 += p.width + gap
  }
  return { width: w, height: h, data }
}

function alphaStats(rgba: Rgba) {
  let opaque = 0
  let transparent = 0
  let soft = 0
  let sumA = 0
  let borderOpaque = 0
  const { width: w, height: h, data } = rgba
  const border = Math.max(2, Math.floor(Math.min(w, h) * 0.01))
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const a = data[(y * w + x) * 4 + 3]!
      sumA += a
      if (a >= 250) opaque += 1
      else if (a <= 5) transparent += 1
      else soft += 1
      const onBorder =
        x < border || y < border || x >= w - border || y >= h - border
      if (onBorder && a >= 128) borderOpaque += 1
    }
  }
  const n = w * h
  return {
    opaquePct: +((100 * opaque) / n).toFixed(2),
    transparentPct: +((100 * transparent) / n).toFixed(2),
    softPct: +((100 * soft) / n).toFixed(2),
    meanAlpha: +(sumA / n).toFixed(2),
    borderKeepPx: borderOpaque,
    borderBandPx: border,
  }
}

/** Carpet-bleed heuristic: among near-transparent pixels, is RGB still carpet-like? */
function transparentRgbResidue(rgba: Rgba, source: Rgba) {
  let checked = 0
  let rgbDiffSum = 0
  const n = Math.min(rgba.data.length, source.data.length)
  for (let i = 0; i < n; i += 4) {
    const a = rgba.data[i + 3]!
    if (a > 5) continue
    checked += 1
    // Fully transparent: RGB may be anything; measure whether cutout RGB matches source
    // (expected) vs baked solid bg (unexpected uniform).
    const dr = Math.abs(rgba.data[i]! - source.data[i]!)
    const dg = Math.abs(rgba.data[i + 1]! - source.data[i + 1]!)
    const db = Math.abs(rgba.data[i + 2]! - source.data[i + 2]!)
    rgbDiffSum += (dr + dg + db) / 3
  }
  return {
    transparentSamples: checked,
    meanRgbDiffVsSourceWhenTransparent:
      checked > 0 ? +(rgbDiffSum / checked).toFixed(3) : null,
    note:
      'Transparent pixels should still carry source RGB (not a baked flat bg). Diff≈0 is expected.',
  }
}

function findSourcePath(id: string): string {
  const png = join(srcRoot, 'sources', `${id}.png`)
  const jpg = join(srcRoot, 'sources', `${id}.jpg`)
  if (existsSync(png)) return png
  if (existsSync(jpg)) return jpg
  throw new Error(`Missing source for ${id}`)
}

/**
 * Visual / metric decisions locked after inspection.
 * polo-6/8: neither auto mask is reliable for product garment preservation.
 */
const SELECTIONS: Record<
  string,
  {
    backend: 'birefnet' | 'lab-seed' | 'manual-required'
    startingMask: 'birefnet' | 'lab-seed' | null
    status: 'accepted' | 'accepted-with-notes' | 'manual-required'
    reasons: string[]
  }
> = {
  'polo-1': {
    backend: 'birefnet',
    startingMask: 'birefnet',
    status: 'accepted',
    reasons: [
      'Clean full-shirt silhouette; carpet removed.',
      'Lab-seed KEEP≈96% retains carpet — rejected.',
    ],
  },
  'polo-2': {
    backend: 'birefnet',
    startingMask: 'birefnet',
    status: 'accepted',
    reasons: ['Clean angled silhouette; edges usable for compositing.'],
  },
  'polo-3': {
    backend: 'birefnet',
    startingMask: 'birefnet',
    status: 'accepted-with-notes',
    reasons: [
      'Shirt silhouette good.',
      'Measuring tape retained as foreground (product intent may want tape removed via brush).',
    ],
  },
  'polo-4': {
    backend: 'birefnet',
    startingMask: 'birefnet',
    status: 'accepted-with-notes',
    reasons: [
      'Shirt silhouette good.',
      'Tape retained; remove with brush/polygon if unwanted.',
    ],
  },
  'polo-5': {
    backend: 'birefnet',
    startingMask: 'birefnet',
    status: 'accepted',
    reasons: ['Collar close-up preserves tags/string; carpet cleared.'],
  },
  'polo-6': {
    backend: 'manual-required',
    startingMask: 'lab-seed',
    status: 'manual-required',
    reasons: [
      'BiRefNet mask is essentially the measuring tape only (fabric missing).',
      'Lab-seed keeps more white fabric but is noisy: carpet bleed left of tape + magenta holes in fabric (mask erosion).',
      'Neither is product-ready. Starting mask = Lab-seed (more garment pixels); brush-restore fabric holes and erase carpet/tape as needed.',
    ],
  },
  'polo-7': {
    backend: 'birefnet',
    startingMask: 'birefnet',
    status: 'accepted-with-notes',
    reasons: [
      'Full shirt usable.',
      'Tape retained; Lab over-keeps carpet relative to BiRefNet.',
    ],
  },
  'polo-8': {
    backend: 'manual-required',
    startingMask: 'lab-seed',
    status: 'manual-required',
    reasons: [
      'BiRefNet mask is tape-only (horizontal strip); white fabric incorrectly removed.',
      'Lab-seed retains more fabric but speckles (erosion) and leaves carpet under the dark tape section.',
      'Neither is product-ready. Starting mask = Lab-seed; manual brush/polygon required.',
    ],
  },
}

function main() {
  for (const d of [
    'selected',
    'comparisons',
    'validation-composites',
    'manual-queue',
  ]) {
    mkdirSync(join(outRoot, d), { recursive: true })
  }

  const rows: Record<string, unknown>[] = []

  for (const id of [
    'polo-1',
    'polo-2',
    'polo-3',
    'polo-4',
    'polo-5',
    'polo-6',
    'polo-7',
    'polo-8',
  ] as const) {
    const sel = SELECTIONS[id]!
    const sourcePath = findSourcePath(id)
    const source = decodeSource(sourcePath)
    const birefPath = join(srcRoot, 'transparent', `${id}-biref-cutout.png`)
    const labPath = join(srcRoot, 'lab-transparent', `${id}-lab-cutout.png`)
    const biref = decodePng(birefPath)
    const lab = decodePng(labPath)
    const birefMask = decodePng(join(srcRoot, 'masks', `${id}-biref-mask.png`))
    const labMask = decodePng(join(srcRoot, 'masks', `${id}-lab-mask.png`))

    const checks: string[] = []
    const fail: string[] = []

    // RGBA decode
    if (biref.data.length !== biref.width * biref.height * 4) {
      fail.push('BiRefNet cutout is not RGBA packed')
    } else checks.push('BiRefNet decodes as RGBA')
    if (lab.data.length !== lab.width * lab.height * 4) {
      fail.push('Lab cutout is not RGBA packed')
    } else checks.push('Lab decodes as RGBA')

    // Dimensions
    if (biref.width !== source.width || biref.height !== source.height) {
      fail.push(
        `BiRefNet size ${biref.width}x${biref.height} ≠ source ${source.width}x${source.height}`,
      )
    } else checks.push('BiRefNet dimensions match source')
    if (lab.width !== source.width || lab.height !== source.height) {
      fail.push(
        `Lab size ${lab.width}x${lab.height} ≠ source ${source.width}x${source.height}`,
      )
    } else checks.push('Lab dimensions match source')

    const birefAlpha = alphaStats(biref)
    const labAlpha = alphaStats(lab)
    const residue = transparentRgbResidue(biref, source)
    if (
      residue.meanRgbDiffVsSourceWhenTransparent != null &&
      residue.meanRgbDiffVsSourceWhenTransparent < 1
    ) {
      checks.push(
        'Transparent-pixel RGB matches source (carpet not baked as flat RGB bg)',
      )
    } else if (residue.meanRgbDiffVsSourceWhenTransparent != null) {
      fail.push(
        `Transparent RGB diverges from source (mean Δ=${residue.meanRgbDiffVsSourceWhenTransparent})`,
      )
    }

    if (birefAlpha.borderKeepPx > biref.width * birefAlpha.borderBandPx * 0.35) {
      // Soft warning — full-bleed garments can touch border
      checks.push(
        `Border KEEP pixels=${birefAlpha.borderKeepPx} (review if unwanted opaque frame)`,
      )
    } else {
      checks.push('No dense opaque border frame on BiRefNet cutout')
    }

    // Select export path
    let selected: Rgba
    let selectedLabel: string
    if (sel.backend === 'birefnet') {
      selected = biref
      selectedLabel = 'birefnet'
      copyFileSync(birefPath, join(outRoot, 'selected', `${id}-cutout.png`))
    } else if (sel.backend === 'lab-seed') {
      selected = lab
      selectedLabel = 'lab-seed'
      copyFileSync(labPath, join(outRoot, 'selected', `${id}-cutout.png`))
    } else {
      // manual-required: ship starting mask cutout into manual-queue, not selected/
      selectedLabel = `manual-required (start=${sel.startingMask})`
      const start =
        sel.startingMask === 'lab-seed' ? labPath : birefPath
      selected = sel.startingMask === 'lab-seed' ? lab : biref
      copyFileSync(
        start,
        join(outRoot, 'manual-queue', `${id}-starting-cutout.png`),
      )
      copyFileSync(
        join(srcRoot, 'masks', `${id}-${sel.startingMask === 'lab-seed' ? 'lab' : 'biref'}-mask.png`),
        join(outRoot, 'manual-queue', `${id}-starting-mask.png`),
      )
      writeFileSync(
        join(outRoot, 'manual-queue', `${id}-NOTES.md`),
        [
          `# ${id} — manual correction required`,
          '',
          ...sel.reasons.map((r) => `- ${r}`),
          '',
          'Use in-app brush / polygon mask editor. Do not invent color heuristics.',
          'Do not fill genuine openings; do not modify source RGB.',
          '',
          `Starting cutout: \`manual-queue/${id}-starting-cutout.png\``,
          `Starting mask: \`manual-queue/${id}-starting-mask.png\``,
          '',
        ].join('\n'),
      )
    }

    // Validation composites for selected (or starting) cutout
    const valDir = join(outRoot, 'validation-composites', id)
    mkdirSync(valDir, { recursive: true })
    for (const [name, rgb] of Object.entries(BG)) {
      writePng(join(valDir, `over-${name}.png`), compositeOver(selected, rgb))
    }

    // Comparison strip: source | biref-over-magenta | lab-over-magenta | masks
    const birefMag = compositeOver(biref, BG.magenta)
    const labMag = compositeOver(lab, BG.magenta)
    // Downscale-ish: if huge side-by-side, still ok for these ~1k images
    const compare = sideBySide([
      {
        width: source.width,
        height: source.height,
        data: new Uint8ClampedArray(source.data),
      },
      birefMag,
      labMag,
      grayToRgba(birefMask),
      grayToRgba(labMask),
    ])
    writePng(join(outRoot, 'comparisons', `${id}-compare.png`), compare)

    // Copy originals into comparisons for convenience
    copyFileSync(
      sourcePath,
      join(outRoot, 'comparisons', `${id}-source${extname(sourcePath)}`),
    )
    copyFileSync(
      birefPath,
      join(outRoot, 'comparisons', `${id}-biref-cutout.png`),
    )
    copyFileSync(labPath, join(outRoot, 'comparisons', `${id}-lab-cutout.png`))

    const selectedAlpha = alphaStats(selected)
    const row = {
      id,
      selection: sel,
      selectedLabel,
      source: {
        path: sourcePath,
        width: source.width,
        height: source.height,
      },
      validation: {
        pass: fail.length === 0,
        checks,
        failures: fail,
        birefAlpha,
        labAlpha,
        selectedAlpha,
        transparentRgbResidue: residue,
      },
      files: {
        selected:
          sel.status === 'manual-required'
            ? `manual-queue/${id}-starting-cutout.png`
            : `selected/${id}-cutout.png`,
        compare: `comparisons/${id}-compare.png`,
        composites: `validation-composites/${id}/`,
      },
    }
    rows.push(row)
    console.log(
      id,
      sel.status,
      selectedLabel,
      fail.length ? `FAIL:${fail.join(';')}` : 'RGBA-ok',
      `soft=${selectedAlpha.softPct}%`,
    )
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sourceArtifacts: 'tmp-model-eval/polo-carpet-cutouts-2026-10-27/',
    outputArtifacts: 'tmp-model-eval/polo-carpet-final-2026-10-27/',
    modelChanged: false,
    pipelineRewritten: false,
    originalCutoutsMutated: false,
    rows,
  }
  writeFileSync(join(outRoot, 'final-report.json'), JSON.stringify(report, null, 2))

  const md = [
    '# Polo carpet cutouts — final validation report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'Source artifacts left untouched: `tmp-model-eval/polo-carpet-cutouts-2026-10-27/`.',
    'No BiRefNet weights / preprocess / postprocess / segment changes in this pass.',
    '',
    '## Selection summary',
    '',
    '| ID | Backend | Status | Soft α% | Manual? |',
    '| --- | --- | --- | ---: | --- |',
    ...rows.map((r) => {
      const row = r as {
        id: string
        selection: { backend: string; status: string }
        validation: { selectedAlpha: { softPct: number } }
      }
      return `| ${row.id} | ${row.selection.backend} | ${row.selection.status} | ${row.validation.selectedAlpha.softPct} | ${row.selection.status === 'manual-required' ? 'YES' : 'no'} |`
    }),
    '',
    '## Per-image decisions',
    '',
  ]

  for (const r of rows) {
    const row = r as {
      id: string
      selection: {
        backend: string
        status: string
        startingMask: string | null
        reasons: string[]
      }
      validation: {
        pass: boolean
        checks: string[]
        failures: string[]
        birefAlpha: Record<string, number>
        labAlpha: Record<string, number>
        transparentRgbResidue: Record<string, unknown>
      }
      files: Record<string, string>
    }
    md.push(`### ${row.id}`)
    md.push('')
    md.push(`- **Selected backend:** \`${row.selection.backend}\``)
    md.push(`- **Status:** ${row.selection.status}`)
    if (row.selection.startingMask) {
      md.push(`- **Starting mask for edits:** \`${row.selection.startingMask}\``)
    }
    md.push(...row.selection.reasons.map((x) => `- ${x}`))
    md.push(
      `- BiRefNet alpha: opaque ${row.validation.birefAlpha.opaquePct}% / transparent ${row.validation.birefAlpha.transparentPct}% / soft ${row.validation.birefAlpha.softPct}%`,
    )
    md.push(
      `- Lab alpha: opaque ${row.validation.labAlpha.opaquePct}% / transparent ${row.validation.labAlpha.transparentPct}% / soft ${row.validation.labAlpha.softPct}%`,
    )
    md.push(
      `- Transparent PNG validation: **${row.validation.pass ? 'PASS' : 'FAIL'}**`,
    )
    md.push(...row.validation.checks.map((c) => `  - ✓ ${c}`))
    md.push(...row.validation.failures.map((c) => `  - ✗ ${c}`))
    md.push(`- Compare strip: \`${row.files.compare}\` (source | BiRef magenta | Lab magenta | BiRef mask | Lab mask)`)
    md.push(`- Export: \`${row.files.selected}\``)
    md.push(`- Composites: \`${row.files.composites}\` (white/black/magenta/beige)`)
    md.push('')
  }

  md.push('## Confirmed defects')
  md.push('')
  md.push('1. **polo-6 / polo-8 auto masks unreliable** — white fabric ≈ carpet; BiRefNet under-keeps fabric; Lab noisy. Manual brush/polygon required.')
  md.push('2. **Tape retention on polo-3,4,7** — not a mask bug if tape is foreground, but product shots may need tape erased in editor.')
  md.push('3. **Lab-seed polo-1** — catastrophic carpet retention (KEEP≈96%); do not use.')
  md.push('')
  md.push('## Files changed')
  md.push('')
  md.push('- **Created only** under `tmp-model-eval/polo-carpet-final-2026-10-27/` (copies + validation composites + report).')
  md.push('- **No edits** to `polo-carpet-cutouts-2026-10-27/` transparent PNGs.')
  md.push('- **No source code / model changes** in this finalization pass.')
  md.push('')

  writeFileSync(join(outRoot, 'FINAL_REPORT.md'), md.join('\n'))
  console.log('Wrote', join(outRoot, 'FINAL_REPORT.md'))
}

main()
