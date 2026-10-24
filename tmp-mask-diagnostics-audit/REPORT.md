# Mask diagnostics audit

**Silhouette source: Lab-seed proxy** (`opencv-seed-fallback`).
This is **not** proof of live RMBG-1.4 quality. Fragmentation metrics below
explain raw vs significant component counts.

| Fixture | neural review | top rule | measured | unit | raw comps | noise | significant | main% | detached% |
|---|---|---|---|---|---|---|---|---|---|
| 01_hoodie.jpg | false | internal_holes | 0.082 | enclosed_bg_pixels / image_pixels (ratio | 14 | 11 | 3 | 100 | 0.1 |
| 02_blazer.jpg | false | — | — | — | 2 | 1 | 1 | 100 | 0.0 |
| 03_tshirt.jpg | true | border_studio_leak | 0.122 | border_studio_keep / border_band_pixels  | 1 | 0 | 1 | 100 | 0.0 |
| 04_jeans.jpg | false | — | — | — | 2 | 1 | 1 | 100 | 0.0 |
| 05_coat.jpg | false | — | — | — | 4 | 3 | 1 | 100 | 0.0 |
| 06_sweater.jpg | false | — | — | — | 10 | 6 | 4 | 100 | 0.1 |
| 07_dress.jpg | false | — | — | — | 6 | 4 | 2 | 100 | 0.2 |
| 08_sneakers.jpg | true | fragmented_keep | 0.694 | detached_significant_area_share (fractio | 92 | 59 | 33 | 29 | 69.4 |
| 09_handbag.jpg | false | internal_holes | 0.062 | enclosed_bg_pixels / image_pixels (ratio | 11 | 9 | 2 | 100 | 0.0 |
| 10_cap.jpg | false | — | — | — | 7 | 5 | 2 | 100 | 0.1 |

## Metric definitions

- **raw comps**: all 4-connected KEEP islands (alpha≥128), including 1px dust.
- **noise**: components smaller than `max(8, 0.004% of image pixels)`.
- **significant**: non-noise components (detail + major).
- **main%**: largest significant component / total KEEP.
- **detached%**: KEEP mass outside the main significant component.
- **`fragmented_keep` measuredValue**: detached area share / major count / detached significant count — **never** raw island count.
- **heuristic score**: risk heuristic 0–1, **not** RMBG model confidence.

Wrote `D:\project\tmp-mask-diagnostics-audit\report.json`