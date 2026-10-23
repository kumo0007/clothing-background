# Max Automatic Segmentation Quality — Report

Generated: 2026-10-23

## Verdict

**Not production-ready** for fully automatic arbitrary-background / white-on-near-white segmentation. Strong dark/chromatic fixtures remain strong. Handbag open-arch cleanup improved measurably. White sneakers remain a hard Lab-ambiguous failure at export time despite mid-pipeline pale retention gains. Confidence flagging now marks uncertain auto-masks for manual review without blocking the batch.

## 1. Confirmed root causes

| Failure | Cause |
| --- | --- |
| White sneaker leather loss | Near-card neutrals are Lab-indistinguishable from studio; border/enclosed strips and chrome/foreign/refine peels erase flat leather even after connectivity reclaim |
| Cap card KEEP (prior) | Flat JPEG lift ~studio+2 blocked removable-studio classification |
| Handbag handle interiors | Open arches are border-connected; enclosed-hole strip misses them; soft AA bridges (mask 80–180) blocked gap clear |
| Silhouette halos | Studio AA kept as opaque KEEP on dark edges |
| Client ZIP beige α=255 | Intentional opaque replacement background |

## 2. Files changed

| File | Change |
| --- | --- |
| `src/lib/mask/paleCompetition.ts` | **New** — competing geodesic assignment (structure vs exterior) for near-card pale; gated to high pale-KEEP-share scenes |
| `src/lib/mask/maskConfidence.ts` | **New** — heuristic confidence + `needsReview` |
| `src/lib/mask/opencv/segmentSeeds.ts` | Run pale competition after local sole reclaim |
| `src/lib/mask/selectSimilar.ts` | Merge competition protect into border/enclosed strips; open-arch clears soft KEEP; chrome skips dark-adjacent pale |
| `src/lib/mask/autoMaskPipeline.ts` | Wire competition + confidence into default Lab-seed path |
| `src/lib/batch/autoMaskCorners.ts` | Return confidence / needsReview |
| `src/types/mask.ts` / `src/App.tsx` | Persist review flag; batch progress mentions review count |
| `src/lib/mask/paleCompetition.test.ts` | Synthetic competition regressions |

GrabCut remains opt-in. Lab-seed remains default. Mask polarity unchanged (255 KEEP / 0 REMOVE).

## 3. Algorithms added

### Pale competition (structure vs exterior)
1. Structure seeds = dark / chromatic / warm KEEP  
2. Exterior seeds = border REMOVE (+ border pale non-structure)  
3. Separate BFS distances through pale-capable pixels; exterior **cannot** shortcut through structure  
4. Pale closer to structure → KEEP; clearly closer to exterior → REMOVE  
5. **Gate:** pale KEEP share ≥ 35%, dark structure present, warm share < 8% (sneakers/tees — not coats/jeans)

### Confidence
Signals: pale KEEP share, border studio leakage, bright edge fringe, soft-alpha ratio, KEEP area extremes. `needsReview` when score < 0.55 or ≥2 reasons. Does **not** claim correctness.

### Open-arch
Gap clear now includes soft KEEP (≥60) so AA bridges under handles can clear.

## 4. Before / after (definite-label IoU)

Baseline: `tmp-final-quality-pass` / `BASELINE_BEFORE.md`  
Fresh: `tmp-auto-mask-max-quality/`

| Fixture | Before IoU | After IoU | Notes |
| --- | ---: | ---: | --- |
| Coat | 0.947 | **0.947** | Stable |
| Sweater | 0.894 | **0.895** | Stable; residual fringe |
| Dress | 0.888 | 0.882 | Thin straps; slight dip |
| Sneakers | 0.339 | 0.338 | **Unresolved** at export; see mid-pipeline |
| Handbag | 0.939 | 0.938 | Hole proxy **101 → 34** |
| Cap | 0.897 | 0.890 | Soft brim halo; slight dip |

Full 10-fixture audit also in this directory (`AUDIT_REPORT.md`).

### Sneaker mid-pipeline evidence (not IoU)
| Stage | Pale KEEP near card (prior) | This pass |
| --- | ---: | ---: |
| After enclosed strip | ~14.7k | **~23.9k** |
| Full export mask | ~9k | ~8.7k |

Competition + protect retain more leather through enclosed/border strips; later chrome/foreign/refine still remove much of it. Definite-label IoU understates leather (large UNCERTAIN band in appearance-derived reference).

## 5. Metrics validity

Reference masks are **appearance+border derived**, not manual paint. Uncertain (128) excluded from binary IoU. Do not treat sneaker/tee IoU as full visual quality. Halo proxy undercounts mid-gray AA — trust magenta QA at 100% zoom.

## 6. Tests / typecheck / build

| Check | Result |
| --- | --- |
| vitest | **118** passed |
| tsc | pass |
| production build | pass |

## 7. Visual QA locations

- Magenta / beige / masks: `tmp-auto-mask-max-quality/{magenta,beige,masks}/`
- Baseline note: `tmp-auto-mask-max-quality/BASELINE_BEFORE.md`
- Client prior ZIP (opaque beige): extracted under `tmp-client-zip-baseline/`

## 8. Regressions checked

- Coat / sweater IoU stable  
- Jeans / blazer restored after tightening competition gate (pale KEEP share ≥ 35%)  
- Transparent / opaque export semantics unchanged (tests)  
- Batch still Lab-seed, non-blocking, per-image progress  

## 9. Still needs manual correction

1. **White sneakers / white tee** on near-white card — Lab-indistinguishable; auto flags `needsReview`  
2. Handbag handle/strap AA fringes (improved holes, residual halo)  
3. Dark garment silhouette AA (sweater/cap/coat fringe)  
4. Thin dress straps  

## 10. Honesty bound

Competing geodesics are a principled improvement over color-only flood, and they measurably help mid-pipeline pale retention and handbag hole clearing. They **cannot** invent contrast that does not exist in the JPEG. Catalog-critical white-on-white still requires brush/polygon edits.
