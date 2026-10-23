# Production readiness report — limited client release

Date: 2026-10-24  
Harnesses: `scripts/evalIsnetEvidenceRefine.mts` → `tmp-isnet-refine/`; `scripts/auditProductionReadiness.mts` → `tmp-prod-audit/`

## Recommendation

**GO for limited client delivery — with mandatory QC on flagged images**

| Decision | Detail |
| --- | --- |
| **Ship** | Lab-seed default + ISNet opt-in with evidence-guided refine, brush/polygon QC, Adjust & Export, batch ZIP |
| **Do not claim** | Unattended white-on-white, universal automatic segmentation, or AGPL clearance |
| **Release blockers** | None for a supervised catalog workflow. **Commercial hosted ISNet** remains a **legal/counsel question** (AGPL), not a functional blocker if Lab-seed is the default and ISNet is optional / counsel-approved |

---

## Verified features & workflow

| Workflow step | Status |
| --- | --- |
| Upload single + batch images | Intact (gallery / Batch panel) |
| Select segmentation method (`auto` Lab-seed / contour / isnet) | Intact; default unchanged |
| ISNet primary + `refineIsnetWithEvidence` | Intact; `methodUsed=isnet-onnx` |
| Raw vs refined inspection (eval artifacts) | `tmp-isnet-refine/` |
| Manual brush / polygon | Intact; edits do **not** clear `needsReview` |
| Undo / redo | Audit + regression: restore pre-edit / redo edit |
| Background replace, adjust (crop/skew/rotate/color/shadow/frame) | Pipeline documented in README; composite path shared |
| Preview vs export parity | Audit `previewExportParity: true` on fixtures |
| PNG / JPEG / ZIP export | Existing export + ZIP paths; audit composites match |
| Per-`imageId` mask / meta isolation | Regression + Batch `setProjects` keyed by id |
| Source RGB unchanged by refine | Eval `rgbUnchanged: true`; audit `rgbPreserved: true` |
| No silent engine fallback | ISNet throws visibly; contour reports fallback-seed + review |
| Rejected refine leaves original ISNet mask | Blazer/jeans FG unchanged; diagnostics `deltaFgRatio=0` |

---

## Visual findings (regenerated artifacts)

Paths: `tmp-isnet-refine/{isnet-raw,isnet-refined}/beige/`, `diff/*-raw-vs-refined.png`, `diagnostics/*.json`, `summary.json`.

| Fixture | Raw→Refined FG | Decision | Review | Visual finding |
| --- | ---: | --- | --- | --- |
| 01_hoodie | 0.522→**0.579** | healed-severance+stripped-studio | no | Hem corridor restored; silhouette acceptable |
| 02_blazer | 0.558→0.558 | reject ambiguous | no | Unchanged; good |
| 03_tshirt | 0.491→0.494 | stripped-studio | **yes** | No studio-card absorb (Lab ~0.63); pale case remains flagged |
| 04_jeans | 0.368→0.368 | reject ambiguous | no | Unchanged; good |
| 05_coat | 0.320→**0.405** | reclaimed-under-recall | **yes** (new) | Lower body recovered; **hem still jagged** — QC required |
| 06_sweater | 0.472→0.472 | reject | no | Preserved |
| 07_dress | 0.191→0.191 | reject | no | Preserved (insufficient evidence to grow) |
| 08_sneakers | 0.341→**0.356** | exterior-dark-bite | **yes** | Gaps preserved; pale leather not unattended-ready |
| 09_handbag | 0.358→0.358 | reject | **yes** | Handle openings preserved; residual gaps → review |
| 10_cap | 0.253→**0.286** | reclaimed-under-recall | **yes** | Brim improved partially; residual dark bites → review |

FG area is **not** accuracy. Coat/cap improvements are real but incomplete.

---

## Confirmed issues this pass

1. **Coat hem noise** — visible jagged lower boundary after large under-recall; previously `needsReview=false` (operators would miss QC).  
   **Fix:** flag large accepted under-recall (`ΔFG ≥ 0.05`) for review — **mask unchanged**.
2. **No safely automatable mask fix** for remaining coat hem speckles, cap residual bites, or white-on-white without risky morphology — left as documented limitations + review flags.
3. **AGPL** on `@imgly/background-removal` (+ node) — outstanding for counsel; not “cleared.”

---

## Files changed (this pass)

| File | Why |
| --- | --- |
| `src/lib/mask/autoMaskPipeline.ts` | `largeUnderRecallNeedsReview` so coat-class recovers stay flagged for boundary QC |
| `src/lib/mask/productionReadiness.regression.test.ts` | Contract test for that review gate |
| `tmp-isnet-refine/**` | Regenerated eval |
| `tmp-prod-audit/PRODUCTION_READINESS_REPORT.md` | This report |

**No segmentation algorithm redesign.** Refine gates / Lab / contour evidence-only contracts preserved.

---

## Verification results

| Command | Result |
| --- | --- |
| `npx vite-node scripts/evalIsnetEvidenceRefine.mts` | Passed |
| `npx vite-node scripts/auditProductionReadiness.mts` | Passed (RGB, polarity, preview/export, undo/redo; ISNet Node `ok`) |
| `npx vitest run` | **207 passed** (27 files) |
| `npx tsc --noEmit` / `npm run build` (`tsc -b && vite build`) | Passed |

---

## Image types requiring manual review

| Type | Why |
| --- | --- |
| White / near-white garments (tee, sneakers) | Pale vs studio; Lab card risk |
| Soft wool/tan on beige (coat) | Residual hem jaggedness after large reclaim |
| Dark soft edges / shadows (cap brim) | Residual exterior dark bites |
| Open handles / straps (handbag) | Intentional holes vs under-recall ambiguity |
| Any `needsReview=true` row in batch progress | UI shows `reviewReason` |

**Usually fine without review (this fixture set):** hoodie (after refine), blazer, jeans, sweater, dress (under-segmented but honest reject).

---

## Deployment & licensing (not legal advice)

| Item | Notes for counsel / ops |
| --- | --- |
| `@imgly/background-removal` / `-node` | **AGPL-3.0** (`LICENSE.md`). Network use / SaaS may trigger source-offer obligations — **unresolved; needs qualified legal review** before commercial hosted ISNet |
| `@techstark/opencv-js` | Apache-2.0 |
| `onnxruntime-web` | MIT |
| React / fflate | MIT |
| Env secrets | None required for core app (client-side). No `.env` secrets in-repo |
| Runtime | Modern browser + WASM; for Batch ISNet prefer vendored assets: `npm run fetch:imgly-data` → `public/imgly-bg-data/1.7.0/` (CDN/`staticimgly.com` can hang) |
| Default path | Lab-seed (`opencv-seed-fallback`) avoids AGPL download unless operator selects ISNet |
| Hosting | Static SPA (`npm run build` → `dist/`); COOP/COEP may be needed for some WASM paths — follow existing Vite/app headers |

**Do not treat this section as license clearance.**

---

## Architecture contracts (unchanged)

- Default engine: Lab-seed / `auto`  
- ISNet when selected: primary mask + evidence refine only  
- `methodUsed = isnet-onnx`  
- Polarity: 255 KEEP / 0 BG / gray soft  
- No source RGB rewrite  
- No blind full-mask union/intersect/replace with Lab or contour  

---

## Remaining limitations

- White-on-white not solved for unattended export  
- Coat hem / cap brim still imperfect after refine  
- ISNet per-pixel model confidence **not exposed** by current wrapper  
- Large WASM/OpenCV bundles in production build (perf/hosting consideration)  
- Universal automatic segmentation is **not** claimed  
