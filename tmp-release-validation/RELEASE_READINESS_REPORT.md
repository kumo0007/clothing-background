# Release readiness — RMBG mask review & repair

Generated: 2026-10-24

## 1. Original full-resolution slip dress

| Item | Result |
|------|--------|
| Source | `C:\Users\KUMO\Downloads\07_slip_dress.jpg` (copied to `tmp-release-validation/`) |
| Dimensions | **374 × 527** (197 098 px) |
| File size | 84 389 bytes |
| Downloads `07_slip_dress-result.png` | **Fully opaque** (α=255 everywhere) — composite/export, **not** a saved MaskPixelBuffer |

### Live RMBG-1.4 (WebGPU) on the original upload

| Metric | Value |
|--------|--------|
| KEEP / BG / soft | 24.41% / 75.59% / 2.40% |
| Alpha hist | 0: 146 939 · soft: 4 729 · 255: 45 430 |
| totalComponents | **1** |
| noise / significant | 0 / 1 |
| largestAreaShare | **1.0** |
| detachedSignificantAreaShare | **0** |
| needsReview | **false** |
| findings | none |
| heuristicScore | 0.84 (not model confidence) |
| resized | false |
| elapsed | ~3.2 s |

**Conclusion:** After the connectivity fix, the original slip dress is a single KEEP component and does **not** trigger `fragmented_keep`.

## 2. Confirmed defect fixed

**Bug:** Vertical 4-connected neighbors used `±height` instead of `±width` in row-major indexing (`fragmentation.ts`, `countKeepComponents`).

**Effect:** On portrait images (H ≠ W), each scanline became its own component → inflated counts (e.g. user-reported **405**), false `fragmented_keep`, misleading Fragments overlay.

**Fix:** Use `±width` for vertical neighbors. Regression: thin strap + body → 1 component; multi-resolution dust tests.

## 3. Before / after (identical connectivity semantics)

| Input | Before (±height bug) | After (±width) |
|-------|----------------------|----------------|
| Portrait slip dress (live RMBG) | Many row-islands → review | 1 component, no review |
| Synthetic strap+body 60×80 | 55 components | 1 component |
| Lab proxy dress | Inflated raw comps | raw 10, significant 3, main 99.7%, no neural review |

## 4. Lifecycle / integrity

- Diagnostics do not mutate masks (tested).
- Border peel preview non-mutating; apply + `MaskHistory` undo restores bytes (tested).
- Diagnostics panel re-runs on `maskRevision` with `cancelled` guard against stale async.
- Manual KEEP paint survives diagnostics (tested).
- No in-browser “saved project” persistence beyond session — N/A for load-from-disk project format.

## 5. Live RMBG vs Lab-seed proxy

| Case | Live RMBG review | Notes |
|------|------------------|--------|
| `07_slip_dress.jpg` | no | 1 component |
| White tee | no | 1 component |
| White sneakers | no | 1 component |
| Handbag | no | info `internal_holes` only |
| Coat / cap / hoodie | no | 1 component |

Lab-seed proxy remains separate (`auditMaskDiagnostics.mts`); it can still flag weak Lab silhouettes (e.g. sneakers) and must **not** be cited as RMBG quality.

## 6. Application / cost / license

| Constraint | Status |
|------------|--------|
| Browser-local inference | Yes (`bg-remove-sdk`, no hosted fallback) |
| Shared remover instance | Yes |
| Model cache | Cache API (~88 MB fp16) |
| Batch concurrency | 1 |
| Commercial | **Blocker:** RMBG-1.4 needs BRIA commercial license (documented in README) |

## 7. Verification

- **259** unit tests pass  
- typecheck / build pass  
- Node slip-dress report: `tmp-release-validation/slip-dress-node-report.json`  
- Live RMBG rows captured in this report  

## Remaining human review

- Soft-edge quality on straps/hems (visual).  
- Handbag openings (`internal_holes` informational).  
- Real border studio leak cases (peel path).  
- Commercial license before catalog production use.

**Not production-ready for commercial catalogs** until BRIA licensing is resolved. Technically, diagnostics/repair/integrity gates for this pass are met on the validated inputs above.
