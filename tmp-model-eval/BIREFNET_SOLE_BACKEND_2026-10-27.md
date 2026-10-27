# BiRefNet sole automatic backend — completion report

**Date:** 2026-10-27  
**Scope:** Make BiRefNet the only Batch/UI auto-mask engine; no silent fallback; keep editor/export.

## 1. Files changed / added / removed

### Changed
- `src/lib/batch/autoMaskCorners.ts` — BiRefNet only; throws on failure
- `src/lib/batch/autoMaskCorners.test.ts` — no-fallback tests
- `src/App.tsx` — BiRefNet preload/batch only; removed backend state
- `src/App.test.tsx` — selector/fallback tests updated
- `src/components/BatchPanel.tsx` — static BiRefNet status (no `<select>`)
- `src/components/BatchPanel.test.tsx`
- `src/lib/mask/commercialModelGate.test.ts` — sole-backend gate
- `src/components/ReviewDiagnosticsPanel.tsx` — default method `birefnet-lite-512`
- `src/lib/mask/sdkMaskReview.ts` — default method `birefnet-lite-512`
- `src/lib/mask/diagnostics/runMaskDiagnostics.ts` — real `ImageData` for overlays (prior fix retained)
- `package.json` — `build` fetches BiRefNet only (no RMBG/worker emit)
- `README.md` — BiRefNet-only docs + DIS5K note

### Not deleted (still used by scripts / unit tests, not Batch UI)
- `src/lib/mask/bgRemoveSdk.ts`, Lab-seed / ISNet / contour / OpenCV paths
- `npm run fetch:rmbg-weights` (optional legacy)

## 2. Engines removed from automatic path

| Engine | Batch UI auto-mask |
| --- | --- |
| BiRefNet_lite 512 | **sole** |
| RMBG-1.4 / bg-remove-sdk | **not called**; no fallback |
| ISNet / contour / Lab-seed / GrabCut | **not** Batch default (scripts only) |

Confirmed: `autoMaskCorners.ts` has no `segmentWithBgRemoveSdk` / `fallbackFrom`. Init failure aborts the batch with a visible error.

## 3. Checkpoint

| Field | Value |
| --- | --- |
| Path | `public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx` |
| Size | **98 484 532** bytes |
| SHA-256 | `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516` |
| I/O | `input_image` → `output_image` `[1,1,512,512]` |
| License | MIT weights/export; **DIS5K training-data terms still need commercial review** |
| Validate | `npm run validate:birefnet-weights` → `allOk: true` (2026-10-27) |

## 4. Preprocess / polarity (unchanged, verified)

- RGB → `/255` → ImageNet mean/std → NCHW float32 512² bilinear  
- Output: **logits + external sigmoid** → soft α → bilinear upscale → **255 KEEP / 0 BG**  
- `repairSdkUnderRecall` **not** applied on BiRefNet path  

## 5. Artifact / bug fixes in this pass

| Fix | Evidence |
| --- | --- |
| No silent RMBG fallback | Unit + commercial gate + App init-fail test |
| Model selector removed | BatchPanel status indicator; tests |
| Diagnostic `putImageData` ImageData | `buildDiagnosticOverlay` returns `new ImageData(...)` + tests |
| Build no longer pulls RMBG into prod chain | `package.json` build; dist has BiRefNet/ORT only (no bgRemoveSdk chunk) |

## 6. Fixture quality (prior measured; not re-claimed as newly fixed)

From `birefnet-bench-post-diagnose-2026-10-27` / polo-carpet final:

- Lab-seed often higher heuristic IoU; BiRefNet ≈ RMBG on many garments  
- White tee / sneakers / polo-on-carpet close-ups remain hard  
- polo-6/8 flagged **manual-required** (tape vs white fabric)  
- Do **not** claim BiRefNet > Lab-seed overall  

## 7. Performance (Node WASM harness, prior diagnose)

| Stage | Approx. |
| --- | --- |
| Cold session | ~9–16 s |
| Warm infer | ~6.9–7.4 s |
| Prep / post | ≪ 50 ms |

WASM default; WebGPU stays disabled unless validated.

## 8. Gates (this run)

| Gate | Result |
| --- | --- |
| typecheck | pass |
| tests | **399** passed, 1 skipped |
| lint | pass (existing warnings) |
| production build | pass |
| validate:birefnet-weights | `allOk: true` |

Browser dual-EP: `npm run verify:birefnet-browser` (run when Chromium available).

## 9. Remaining limitations

- White-on-light / carpet close-ups need manual edit  
- Tape on product shots may be kept as FG  
- Warm WASM ~7 s/image  
- WebGPU still degenerate on previously tested adapters  
- Legacy packages remain in `node_modules` / optional scripts — not Batch auto-mask  

## 10. Commands

```bash
npm install
npm run fetch:birefnet-weights
npm run validate:birefnet-weights
npm run verify:birefnet-browser   # optional Chromium
npm run typecheck && npm test && npm run lint && npm run build
npm run dev
```
