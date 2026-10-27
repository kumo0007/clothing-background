# Polo carpet cutouts — final validation report

Generated: 2026-10-27T08:09:09.964Z

Source artifacts left untouched: `tmp-model-eval/polo-carpet-cutouts-2026-10-27/`.
No BiRefNet weights / preprocess / postprocess / segment changes in this pass.

## Selection summary

| ID | Backend | Status | Soft α% | Manual? |
| --- | --- | --- | ---: | --- |
| polo-1 | birefnet | accepted | 1.29 | no |
| polo-2 | birefnet | accepted | 1.27 | no |
| polo-3 | birefnet | accepted-with-notes | 3.99 | no |
| polo-4 | birefnet | accepted-with-notes | 1.7 | no |
| polo-5 | birefnet | accepted | 1.16 | no |
| polo-6 | manual-required | manual-required | 3.7 | YES |
| polo-7 | birefnet | accepted-with-notes | 1.72 | no |
| polo-8 | manual-required | manual-required | 5.74 | YES |

## Per-image decisions

### polo-1

- **Selected backend:** `birefnet`
- **Status:** accepted
- **Starting mask for edits:** `birefnet`
- Clean full-shirt silhouette; carpet removed.
- Lab-seed KEEP≈96% retains carpet — rejected.
- BiRefNet alpha: opaque 39.39% / transparent 59.32% / soft 1.29%
- Lab alpha: opaque 94.16% / transparent 3.46% / soft 2.38%
- Transparent PNG validation: **PASS**
  - ✓ BiRefNet decodes as RGBA
  - ✓ Lab decodes as RGBA
  - ✓ BiRefNet dimensions match source
  - ✓ Lab dimensions match source
  - ✓ Transparent-pixel RGB matches source (carpet not baked as flat RGB bg)
  - ✓ No dense opaque border frame on BiRefNet cutout
- Compare strip: `comparisons/polo-1-compare.png` (source | BiRef magenta | Lab magenta | BiRef mask | Lab mask)
- Export: `selected/polo-1-cutout.png`
- Composites: `validation-composites/polo-1/` (white/black/magenta/beige)

### polo-2

- **Selected backend:** `birefnet`
- **Status:** accepted
- **Starting mask for edits:** `birefnet`
- Clean angled silhouette; edges usable for compositing.
- BiRefNet alpha: opaque 39.99% / transparent 58.74% / soft 1.27%
- Lab alpha: opaque 43.62% / transparent 56.03% / soft 0.34%
- Transparent PNG validation: **PASS**
  - ✓ BiRefNet decodes as RGBA
  - ✓ Lab decodes as RGBA
  - ✓ BiRefNet dimensions match source
  - ✓ Lab dimensions match source
  - ✓ Transparent-pixel RGB matches source (carpet not baked as flat RGB bg)
  - ✓ No dense opaque border frame on BiRefNet cutout
- Compare strip: `comparisons/polo-2-compare.png` (source | BiRef magenta | Lab magenta | BiRef mask | Lab mask)
- Export: `selected/polo-2-cutout.png`
- Composites: `validation-composites/polo-2/` (white/black/magenta/beige)

### polo-3

- **Selected backend:** `birefnet`
- **Status:** accepted-with-notes
- **Starting mask for edits:** `birefnet`
- Shirt silhouette good.
- Measuring tape retained as foreground (product intent may want tape removed via brush).
- BiRefNet alpha: opaque 65.96% / transparent 30.05% / soft 3.99%
- Lab alpha: opaque 37.56% / transparent 58.31% / soft 4.14%
- Transparent PNG validation: **PASS**
  - ✓ BiRefNet decodes as RGBA
  - ✓ Lab decodes as RGBA
  - ✓ BiRefNet dimensions match source
  - ✓ Lab dimensions match source
  - ✓ Transparent-pixel RGB matches source (carpet not baked as flat RGB bg)
  - ✓ No dense opaque border frame on BiRefNet cutout
- Compare strip: `comparisons/polo-3-compare.png` (source | BiRef magenta | Lab magenta | BiRef mask | Lab mask)
- Export: `selected/polo-3-cutout.png`
- Composites: `validation-composites/polo-3/` (white/black/magenta/beige)

### polo-4

- **Selected backend:** `birefnet`
- **Status:** accepted-with-notes
- **Starting mask for edits:** `birefnet`
- Shirt silhouette good.
- Tape retained; remove with brush/polygon if unwanted.
- BiRefNet alpha: opaque 49.48% / transparent 48.82% / soft 1.7%
- Lab alpha: opaque 35.26% / transparent 60.39% / soft 4.35%
- Transparent PNG validation: **PASS**
  - ✓ BiRefNet decodes as RGBA
  - ✓ Lab decodes as RGBA
  - ✓ BiRefNet dimensions match source
  - ✓ Lab dimensions match source
  - ✓ Transparent-pixel RGB matches source (carpet not baked as flat RGB bg)
  - ✓ No dense opaque border frame on BiRefNet cutout
- Compare strip: `comparisons/polo-4-compare.png` (source | BiRef magenta | Lab magenta | BiRef mask | Lab mask)
- Export: `selected/polo-4-cutout.png`
- Composites: `validation-composites/polo-4/` (white/black/magenta/beige)

### polo-5

- **Selected backend:** `birefnet`
- **Status:** accepted
- **Starting mask for edits:** `birefnet`
- Collar close-up preserves tags/string; carpet cleared.
- BiRefNet alpha: opaque 73.21% / transparent 25.64% / soft 1.16%
- Lab alpha: opaque 27.28% / transparent 65.9% / soft 6.83%
- Transparent PNG validation: **PASS**
  - ✓ BiRefNet decodes as RGBA
  - ✓ Lab decodes as RGBA
  - ✓ BiRefNet dimensions match source
  - ✓ Lab dimensions match source
  - ✓ Transparent-pixel RGB matches source (carpet not baked as flat RGB bg)
  - ✓ Border KEEP pixels=9575 (review if unwanted opaque frame)
- Compare strip: `comparisons/polo-5-compare.png` (source | BiRef magenta | Lab magenta | BiRef mask | Lab mask)
- Export: `selected/polo-5-cutout.png`
- Composites: `validation-composites/polo-5/` (white/black/magenta/beige)

### polo-6

- **Selected backend:** `manual-required`
- **Status:** manual-required
- **Starting mask for edits:** `lab-seed`
- BiRefNet mask is essentially the measuring tape only (fabric missing).
- Lab-seed keeps more white fabric but is noisy: carpet bleed left of tape + magenta holes in fabric (mask erosion).
- Neither is product-ready. Starting mask = Lab-seed (more garment pixels); brush-restore fabric holes and erase carpet/tape as needed.
- BiRefNet alpha: opaque 13.67% / transparent 83.95% / soft 2.38%
- Lab alpha: opaque 30.03% / transparent 66.27% / soft 3.7%
- Transparent PNG validation: **PASS**
  - ✓ BiRefNet decodes as RGBA
  - ✓ Lab decodes as RGBA
  - ✓ BiRefNet dimensions match source
  - ✓ Lab dimensions match source
  - ✓ Transparent-pixel RGB matches source (carpet not baked as flat RGB bg)
  - ✓ No dense opaque border frame on BiRefNet cutout
- Compare strip: `comparisons/polo-6-compare.png` (source | BiRef magenta | Lab magenta | BiRef mask | Lab mask)
- Export: `manual-queue/polo-6-starting-cutout.png`
- Composites: `validation-composites/polo-6/` (white/black/magenta/beige)

### polo-7

- **Selected backend:** `birefnet`
- **Status:** accepted-with-notes
- **Starting mask for edits:** `birefnet`
- Full shirt usable; BiRefNet preferred over Lab.
- Measuring tape retained as foreground (brush-erase if unwanted).
- Mild warm fringe / soft edge along hem on magenta preview — soft α ~1.7%, not carpet baked into RGB.
- BiRefNet alpha: opaque 48.97% / transparent 49.31% / soft 1.72%
- Lab alpha: opaque 57.28% / transparent 37.77% / soft 4.95%
- Transparent PNG validation: **PASS**
  - ✓ BiRefNet decodes as RGBA
  - ✓ Lab decodes as RGBA
  - ✓ BiRefNet dimensions match source
  - ✓ Lab dimensions match source
  - ✓ Transparent-pixel RGB matches source (carpet not baked as flat RGB bg)
  - ✓ No dense opaque border frame on BiRefNet cutout
- Compare strip: `comparisons/polo-7-compare.png` (source | BiRef magenta | Lab magenta | BiRef mask | Lab mask)
- Export: `selected/polo-7-cutout.png`
- Composites: `validation-composites/polo-7/` (white/black/magenta/beige)

### polo-8

- **Selected backend:** `manual-required`
- **Status:** manual-required
- **Starting mask for edits:** `lab-seed`
- BiRefNet mask is tape-only (horizontal strip); white fabric incorrectly removed.
- Lab-seed retains more fabric but speckles (erosion) and leaves carpet under the dark tape section.
- Neither is product-ready. Starting mask = Lab-seed; manual brush/polygon required.
- BiRefNet alpha: opaque 16.58% / transparent 82.22% / soft 1.19%
- Lab alpha: opaque 41.02% / transparent 53.24% / soft 5.74%
- Transparent PNG validation: **PASS**
  - ✓ BiRefNet decodes as RGBA
  - ✓ Lab decodes as RGBA
  - ✓ BiRefNet dimensions match source
  - ✓ Lab dimensions match source
  - ✓ Transparent-pixel RGB matches source (carpet not baked as flat RGB bg)
  - ✓ No dense opaque border frame on BiRefNet cutout
- Compare strip: `comparisons/polo-8-compare.png` (source | BiRef magenta | Lab magenta | BiRef mask | Lab mask)
- Export: `manual-queue/polo-8-starting-cutout.png`
- Composites: `validation-composites/polo-8/` (white/black/magenta/beige)

## Confirmed defects

1. **polo-6 / polo-8 auto masks unreliable** — white fabric ≈ carpet; BiRefNet under-keeps fabric (tape-only); Lab noisy with carpet bleed + fabric holes. Manual brush/polygon required. Starting files in `manual-queue/`.
2. **Tape retention on polo-3,4,7** — BiRefNet treats tape as foreground. Optional product cleanup via existing brush/polygon editor (not an auto-heuristic change).
3. **Lab-seed polo-1** — catastrophic carpet retention (opaque α ≈94%); do not use.

## Transparent PNG validation (all eight)

| Check | Result |
| --- | --- |
| Decodes as RGBA | PASS (all BiRefNet + Lab cutouts) |
| Dimensions = source | PASS |
| Carpet not baked as flat RGB bg | PASS (transparent pixels retain source RGB; visibility via α) |
| Composite white/black/magenta/beige | Generated under `validation-composites/<id>/` |
| Soft alpha / halo | Low on accepted BiRefNet (≈1.2–1.7%); polo-3 soft≈4% (tape edges) |
| Unwanted opaque border frame | None material; polo-5 high border KEEP is expected (collar fills frame) |

## Files changed

- **Created only** under `tmp-model-eval/polo-carpet-final-2026-10-27/` (selected copies, comparison strips, validation composites, manual-queue starters, this report, `final-report.json`).
- **No edits** to `polo-carpet-cutouts-2026-10-27/` transparent PNGs (six recommended BiRefNet cutouts unchanged).
- **No source code / model / pipeline changes** in this finalization pass.
- Helper script only: `scripts/finalizePoloCarpetCutouts.mts` (read/validate/copy; does not mutate BiRefNet).
