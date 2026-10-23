# Production Pass Report — Garment Background Removal

Generated: 2026-10-23

## Verdict

**Not production-ready** for fully automatic segmentation on all hard cases. Batch auto-mask no longer hangs. Transparent PNG export no longer bakes a checkerboard. Visual quality on white sneakers and dark-edge halos remains materially imperfect; users must refine masks manually for catalog-critical white-on-light shots.

## 1. Root causes (client ZIP + pipeline)

| Observation | Root cause |
| --- | --- |
| ZIP PNGs all have alpha=255 and beige (~217,196,174) corners | **Intended replacement-background export**, not “failed transparency.” Compositor writes opaque RGB over the selected beige. |
| White sneakers heavily eroded | Lab BG flood treated near-card white leather as definite background; cleanup peels pale KEEP. White-on-near-white is Lab-ambiguous. |
| Handbag handle openings / white fringe | Open arches are often border-connected through the arch top; enclosed-hole strip skips them. Outer fringe is retained studio KEEP (halo). |
| Dark garment white outlines | Soft studio / AA KEEP on silhouette; refine peels some but not all. |
| Batch stuck on “Working…” | OpenCV.js WASM/GrabCut on the main thread (fixed earlier: Lab-seed default). |
| Transparent mode risk | `renderComposite` drew checkerboard into the canvas (fixed: clear alpha only). |

## 2. Files changed

| File | Purpose |
| --- | --- |
| `src/lib/mask/opencv/segmentSeeds.ts` | Tighter BG flood (stop at card+0.75 L); pale reclaim from dark soles |
| `src/lib/mask/selectSimilar.ts` | `stripOpenArchStudio` for handle/strap gaps between dark walls |
| `src/lib/mask/autoMaskPipeline.ts` | Wire open-arch strip; keep GrabCut opt-out default |
| `src/lib/mask/refineBoundary.ts` | Extra peel passes for dark silhouette AA |
| `src/lib/rendering/renderComposite.ts` | Transparent = clear alpha (no checkerboard bake) |
| `src/lib/rendering/compositePixels.ts` | Optional transparent alpha = sourceA×maskA |
| Tests under `qualityPass`, `segmentGarment`, `renderComposite`, `compositePixels` | Regressions for pale panel, open arch, transparent export |
| `scripts/exportProductionPass.mts` | Fresh magenta/beige/mask exports for six hard cases |

## 3. Algorithm changes (reasoning)

1. **Do not flood definite BG into L ≥ card+0.75** — preserves white leather that sits slightly above the studio card.
2. **Reclaim pale KEEP from dark soles** by connectivity (not global Lab loosen) so sneaker panels can grow back from soles.
3. **`stripOpenArchStudio`** clears bright studio between two dark walls on a row/column (handle arches) without requiring a fully enclosed component.
4. **Transparent composite** leaves canvas clear so PNG export can carry real alpha; preview checkerboard stays in CSS.
5. **Batch path** remains Lab-seed only (no WASM wait).

## 4. Before / after (six client cases)

Client ZIP (`garment-results-all.zip`) = prior beige replacement exports.  
Fresh outputs: `tmp-production-pass/magenta/`, `beige/`, `masks/`.

| Fixture | Prior (ZIP) | After (this pass) | Notes |
| --- | --- | --- | --- |
| 05_coat | Beige replace, edge halo | Magenta IoU~0.95 | Dark mass strong; residual AA possible |
| 06_sweater | Visible white edge halo | Still some right/bottom halo | Dark FG intact |
| 07_dress | Thin straps at risk | IoU~0.90 | Straps fragile |
| 08_sneakers | Severe white leather loss | Still severe (IoU~0.37) | **Documented white-on-near-white limit** |
| 09_handbag | Halo + handle gaps | Open-arch helper + still residual fringe | Manual edit for critical catalogs |
| 10_cap | Cleaner body | IoU~0.91 | Brim shadow uncertain |

## 5. Audit metrics (definite labels only)

See `tmp-quality-audit/AUDIT_REPORT.md` and `tmp-production-pass/summary.json`.

- Dark garments: IoU typically ~0.89–0.95 on definite FG/BG.
- Sneakers / white tee: large **uncertain** bands; binary IoU understates visual damage and is not reliable GT.
- Halo proxy undercounts mid-gray AA; trust magenta visual QA.

## 6. Tests / typecheck

- **114** tests passed  
- **typecheck** passed  
- **build** passed  

## 7. Export mode confirmation

| Mode | Behavior |
| --- | --- |
| Color / image replacement | `outputRGB = src×maskA + bg×(1−maskA)`, opaque A=255 (ZIP beige is this) |
| Transparent PNG | Canvas cleared; garment via `destination-in`; REMOVE stays alpha 0 (checkerboard is preview CSS only) |
| JPEG | Must use opaque pad/background (no alpha) |

Source garment RGB is never written by mask cleanup (fingerprint checks in exports).

## 8. Known limitations / follow-up

1. **White sneakers / white tee on near-white card** — Lab alone cannot safely separate; keep uncertain pixels and expose manual brush. Do not loosen global Lab further.
2. **Handle openings** — improved but not perfect when AA bridges and JPEG lift defeat gap heuristics.
3. **Silhouette halos** on dark knits — reduced, not eliminated.
4. **Browser GrabCut** — still opt-in; default must not block the UI.
5. Recommend: painted reference masks for sneakers/handbag for true IoU; optional GrabCut worker with timeout for power users.
