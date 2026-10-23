# Contour / Auto-Mask Fix Report

Generated: 2026-10-23

## Verdict

Large angular studio-card slabs on dark garments (blazer, jeans, hoodie) were a **pipeline defect**, not a polygon-UI gap. Soft-alpha walls + near-card JPEG vignette (+4–8 L above the corner sample) blocked border studio stripping, while dark-hem variance falsely protected card as “pale leather.”

Lab-seed remains default; ISNet stays opt-in. White tee / sneakers remain hard cases and stay `needsReview` where confidence is low. Automated pass ≠ visual acceptance.

## Root causes (confirmed)

| Failure | Cause | Evidence |
| --- | --- | --- |
| Blazer / jeans / hoodie large white slabs on beige export | KEEP on studio card; soft alpha (1–254) blocked `stripBorderConnectedStudio` (only walked exact 0/255) | Stage probe: border strip painted 0; borderKeep stayed ~8–16% |
| Slabs survived peel | Card pixels at L≈234–237 vs corner 230; `isRemovableStudioPixel` stopped at card+0.5 / low variance | Luma histogram of leftover KEEP |
| Reclaim re-grew card around dark hems | `fromSole` / brighter-than-studio with edge-inflated variance | Probe: reclaim raised blazer borderKeep 8.3% → 12.4% |
| Pale protect shielded card | `markDarkConnectedPale` treated high-variance near-card as leather | Peel no-ops until gate tightened |
| White tee / sneakers | Lab ambiguity (garment ≈ card) | Still high uncertain ratio; not solved by card peel |
| Handbag handle residue | Open-arch + fringe; improved but not perfect | Residual soft fringe possible |
| Compositing / polarity | No contract break found | Preview/export same `compositePixelBuffers`; source RGB unchanged |

Client ZIP `garment-results-all.zip` = prior unacceptable beige exports (inspected under `tmp-garment-results-inspect/`).

## Fixes

1. **`stripBorderConnectedStudio`** — traverse/strip soft studio; weak fringe (&lt;96) no longer walls the flood.
2. **`peelExteriorStudioKeep`** — exterior-in peel of near-card KEEP (wider +10 L band) without wiping protected leather.
3. **`stripBorderTouchingStudioComponents`** — drop border-touching studio-only components.
4. **Reclaim guards** — refuse flat near-card neutrals; tighten `fromSole`.
5. **Seed textured KEEP** — require stronger texture (`lumaVar > 28`) so JPEG noise ≠ FG.
6. **`maskContour.ts`** — Moore trace + Douglas–Peucker; holes; round-trip tests; editor “Trace mask contour”.
7. **App** — preserve `needsReview` on manual edits (earlier).

## Measured (definite-label IoU + border KEEP)

See `tmp-contour-diagnose/summary.json` and visuals under `tmp-contour-diagnose/{source,masks,overlay,magenta,beige,transparent,edge}/`.

Proxy studio-KEEP fraction inside KEEP (near-card RGB) and beige-export near-white remnant %:

| Fixture | studioKeepPct | borderKeepPct | beige near-white % | needsReview |
| --- | ---: | ---: | ---: | --- |
| hoodie | ~0.8% | 0% | **0.26%** | false |
| blazer | ~0.1% | ~0.75% | **0.26%** | false |
| jeans | ~0.2% | ~1.7% | **0.30%** | false |
| handbag | ~0.4% | 0% | **0.61%** | false |
| sneakers | ~12% (pale≈card) | 0% | **6.2%** | **true** |
| tshirt | contaminated | ~9% | **62%** | **true** |

Before (client ZIP / prior Lab path): angular card slabs were a large visible fraction of the frame on blazer/jeans/hoodie. After: remnant white ≈0.3% on those dark/chromatic products.

## Files changed

- `src/lib/mask/selectSimilar.ts` — soft-alpha strip, peel, pale/reclaim/near-card gates
- `src/lib/mask/opencv/segmentSeeds.ts` — textured KEEP gate
- `src/lib/mask/autoMaskPipeline.ts` — wire peel / border-studio components
- `src/lib/mask/maskContour.ts` + `maskContour.test.ts` — contour utility
- `src/components/MaskEditor.tsx` / `MaskToolbar.tsx` — Trace mask contour
- `scripts/diagnoseContourFailures.mts` (+ probes)

## Tests / typecheck / build

Run after this report; expect full suite green.

## Remaining limitations

- White tee and white sneakers still need **manual Polygon Select** (add/subtract).
- Thin dress straps / residual AA halo may need brush or feather.
- Contour trace follows the **current** mask — incorrect auto mask ⇒ incorrect contour; use subtract/add polygons for correction.
- Do not treat passing tests as visual acceptance on hard white-on-white shots.
