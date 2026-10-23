# Contour validation + strategy selection verification

Date: 2026-10-23  
Artifacts: `tmp-contour-validation/`  
Script: `scripts/verifyContourValidation.mts`

## Acceptance (measured)

| Fixture | Lab `methodUsed` | Contour `methodUsed` | Contour decision | Reject reason | needsReview |
| --- | --- | --- | --- | --- | --- |
| 03_tshirt | `opencv-seed-fallback` | `contour-first-fallback-seed` | **reject** | `follows-studio-card` | true |
| 08_sneakers | `opencv-seed-fallback` | `contour-first-fallback-seed` | **reject** | `excessive-gap-weak-agreement` | true |
| 02_blazer | `opencv-seed-fallback` | `contour-first` | **accept** | — | false |
| 04_jeans | `opencv-seed-fallback` | `contour-first` | **accept** | — | true (confidence/substantial flag; still accepted) |

Lab-seed remains the batch default. Contour / ISNet stay opt-in.

ISNet: requested explicitly; unavailable in this environment (`Unsupported format` from `@imgly` path) — failure is visible, not silently swapped to Lab.

## Validation evidence (tee)

After prune: `areaRatio≈0.52`, `exteriorRatio≈0.32`, `spanY≈0.98`, `spanX≈0.76`, `reliableFgRatio≈0.005`.

Rejected as `follows-studio-card` (tall near-full-frame slab + thin exterior). Also covered by `insufficient-reliable-fg-for-area` (pale seed is not structural FG).

## Validation evidence (sneakers)

`substantialGapCompletion=true`, `gapAddedRatio≈0.033`, `seedAgreement≈0.27` → `excessive-gap-weak-agreement`. Fallback labeled `contour-first-fallback-seed` with `fallbackReason` set.

## Dark garment (blazer)

Accepted contour-first; Lab vs contour differ only on a thin edge fringe (`diff/02_blazer-lab-vs-contour.png`). Export is a clean beige composite.

## UI visibility

- Batch progress reports actual `methodUsed`.
- Per-image status shows `method …` and `review: seed-prior after <reason>` when contour falls back.
- Seed fallback is never labeled `contour-first`.

## Visual inspection notes

- Tee contour export after fallback still shows white-on-white Lab-seed limitations (expected — contour was refused; seed is the documented fallback). Diff vs Lab is non-empty.
- Sneakers fallback shows sparse KEEP (needs review) rather than an invented oversized contour silhouette.
- Blazer contour export is production-quality for a dark garment.

## Not claimed

Production readiness for white-on-white. Contour remains opt-in until measured wins justify promoting it.
