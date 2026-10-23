# Final Targeted Quality Pass Report

Generated: 2026-10-23

## Verdict

**Not production-ready** for fully automatic segmentation on hard cases (white-on-near-white sneakers, residual handle/strap studio, dark-edge AA halos). Batch non-blocking Lab-seed path, transparent vs opaque export semantics, and dark/chromatic garment baselines remain intact. Manual mask edits are still required for catalog-critical white sneakers and some handle/halo cleanups.

## 1. Root causes confirmed

| Issue | Confirmed cause |
| --- | --- |
| Client ZIP beige corners (α=255) | Selected opaque replacement background — not a transparency failure |
| White sneaker leather loss | Lab BG flood + cleanup treat near-card neutrals as studio; connectivity reclaim cannot safely recover flat leather without also retaining card |
| Cap IoU crash (~0.50–0.66 during this pass) | Flat JPEG card at L≈studio+2 marked KEEP; `isRemovableStudioPixel` refused to strip any lift > studio+0.5, so border flood painted **0** |
| Handbag open arches | Open tops are border-connected; enclosed-component strip misses them — `stripOpenArchStudio` helps; AA bridges remain |
| Dark-edge white fringe | Studio AA kept as opaque KEEP; refine peels some, not all |
| Batch hang (prior) | OpenCV.js WASM/GrabCut on main thread — Lab-seed default (unchanged) |
| Transparent checkerboard bake (prior) | Preview pattern drawn into canvas — cleared alpha path (unchanged) |

## 2. Files changed (this pass)

| File | Why |
| --- | --- |
| `src/lib/mask/selectSimilar.ts` | Allow flat JPEG card lift (≤studio+3.5, low variance) as removable; tighten `markDarkConnectedPale` distance/gates; stop `reclaimGarmentFromKeep` fromSole using dark-inflated variance |
| `src/lib/mask/opencv/segmentSeeds.ts` | Stricter `brightLeather` / soft-KEEP bias; distance-limited pale reclaim from dark soles (no card flood from brims) |
| Tests under `qualityPass` / `segmentGarment` | Existing regressions still green (synthetic pale panel, open arch, export polarity) |

No GrabCut/WASM reintroduced on the default path. Mask polarity unchanged: **255 = KEEP**, **0 = REMOVE**, mid = partial alpha.

## 3. Tests / typecheck / build

| Check | Result |
| --- | --- |
| `vitest run` | **115** passed |
| `tsc --noEmit` | pass |
| `npm run build` | pass |

## 4. Before / after (evidence)

Fresh outputs: `tmp-final-quality-pass/` (copy of latest `tmp-production-pass/`)  
Magenta / beige / masks under those folders. Full 10-fixture audit: `tmp-quality-audit/` and copies in this directory.

| Fixture | Definite-label IoU (this pass) | Notes |
| --- | --- | --- |
| 05_coat | **0.947** | Strong dark/chromatic mass; residual AA possible |
| 06_sweater | **0.894** | Body intact; right/bottom studio fringe remains |
| 07_dress | **0.888** | Thin straps fragile |
| 08_sneakers | **0.339** | **Unresolved** white-on-near-white leather loss |
| 09_handbag | **0.939** (holes proxy ~101) | Body good; handle-inner AA / strap fringe remain |
| 10_cap | **0.897** | Recovered from ~0.50–0.66 mid-pass; soft brim halo remains |

Cap recovery check: after flat-card removable fix, `stripBorderConnectedStudio` paints tens of thousands of studio pixels (was **0**); top-row KEEP cleared.

Sneaker stage probe (pale KEEP near card): seeds ~57k → after enclosed ~15k → final ~9k. Connectivity reclaim preserves some sole-adjacent pale; large white panels still missing — Lab-ambiguous vs flat card.

### Export semantics (verified by tests + pipeline)

| Mode | Expected |
| --- | --- |
| Opaque beige/color BG | Corners α=255, replacement RGB — intentional |
| Transparent PNG | Real alpha; checkerboard is preview CSS only |
| Batch | Per-image Lab-seed; progress after each; GrabCut opt-in only |

## 5. Fixed vs improved vs unresolved

**Fixed / restored**

- Cap border-studio retention caused by non-removable JPEG lift (IoU restored ~0.90)
- Pale reclaim no longer floods entire card from dark brims (seed-stage)
- `fromSole` reclaim no longer treats dark-neighbor variance as leather proof

**Improved (partial)**

- Open-arch strip for handle gaps (topology helper; residual AA under arches)
- Silhouette refine multi-pass peel for dark+bright fringe (halos reduced, not gone)
- Pale protect local to soles for enclosed strip (helps synthetic panels; limited on real sneakers)

**Unresolved — expect manual correction**

1. White sneakers / white tee on near-white card  
2. Handbag handle interiors + thin strap AA fringes  
3. Sweater/coat/cap silhouette halos (studio AA as opaque KEEP)  
4. Appearance-derived reference IoU understates visual sneaker damage and is not manual GT

## 6. Limitations

- No AI / external segmentation API by design  
- Lab + topology heuristics cannot separate flat white leather from studio card safely  
- Aggressive global Lab loosen or blanket erosion would damage dark garments / retain card  
- Manual brush / polygon remain the production fallback for ambiguous shots  

**Do not claim production readiness for fully automatic hard cases.**
