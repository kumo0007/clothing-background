# BiRefNet mask alignment, diagnostics, peel lifecycle, and white-garment remediation

**Date:** 2026-10-28  
**Branch:** `experiment/birefnet-webgpu-graph-rewrite` (production path patched; WebGPU rewrite still isolated)  
**Verdict: NOT APPROVED TO SHIP as “fully production-ready” for all polo/carpet/tape cases — deterministic defects fixed; hard-case quality remains review-gated.**

---

## 1. Root causes (by screenshot issue)

| Issue | Root cause | Fix |
| --- | --- | --- |
| **A. `mask_resized` on every BiRefNet result** | `segmentWithBirefNet` always passed `resized: true` with `forcesReview: true`, even for expected 512→source bilinear upsample. Warning looked like a defect. | Expected upsample → **info**, `forcesReview: false`. Suspicious dim mismatch → review. |
| **A. Alignment geometry** | No letterbox; stretch 512↔source with pixel-center bilinear. Contract tests added. | Documented + `maskAlignment.contract.test.ts`. Not a 1px systematic shift bug. |
| **B. `border_studio_leak` on collar fill-frame** | Flat+bright border KEEP counted as “studio” even when garment fills the frame (polo-5). | Require **flat** variance for studio pixels; fill-frame → uncertain, not forced peel. |
| **B. Carpet remnants near white polo** | BiRefNet soft edges on beige carpet; no automatic carpet peel (and `repairSdkUnderRecall` correctly disabled). | New conservative `refineTexturedBorderLeak` — peels border-connected **textured** KEEP only; protects bright fabric + thin dark tape. |
| **C. Measuring tape** | Must stay KEEP. Prior reports already retained tape; aggressive cleanup was the risk. | Tape protected in textured refine; no tape-removal heuristic. polo-3/4/7/8 remain product-intent KEEP. |
| **D. Border peel Apply/Undo** | Stale preview across revisions; Undo unmounted when review cleared; nearest upsample could quantize soft α. | Preview bound to `imageId`+`maskRevision`; clear on external edits; App keeps panel while `peelUndoAvailable`; REMOVE-only merge on upsampled apply. |
| **E. `putImageData` type error** | Overlay previously returned a plain object cast as `ImageData`. | `new ImageData(...)` + runtime instanceof/length checks + `createImageData` fallback. |
| **F. Stale diagnostics** | Live panel re-diagnose dropped `resized`; peel could apply after brush. | Revision-gated preview; re-diagnose without false resize defect; undo availability lifted to App. |
| **polo-6 WebGPU IoU 0.874** | Experimental GatherND rewrite FP16 GPU vs WASM numeric drift on a known hard hem case — **not** a production WASM path bug. | Rewrite stays **disabled**; production unchanged default. |

---

## 2. Files changed

| File | Purpose |
| --- | --- |
| `src/lib/mask/diagnostics/runMaskDiagnostics.ts` | Expected vs suspicious resize; fill-frame border leak severity |
| `src/lib/mask/diagnostics/maskMetrics.ts` | Flat-only border studio counting |
| `src/lib/mask/diagnostics/runMaskDiagnostics.test.ts` | Resize info + fill-frame tests |
| `src/lib/mask/sdkMaskReview.ts` | Pass `resizedSuspicious` |
| `src/lib/mask/sdkMaskReview.test.ts` | Updated resize expectations |
| `src/lib/mask/birefNet/segment.ts` | Accurate resize flags; color-aware review dims; textured border refine |
| `src/lib/mask/birefNet/refineTexturedBorderLeak.ts` | Conservative carpet/backdrop peel |
| `src/lib/mask/birefNet/refineTexturedBorderLeak.test.ts` | Carpet peel + tape preservation |
| `src/lib/mask/birefNet/maskAlignment.contract.test.ts` | Dim/soft-α/indexing contracts |
| `src/lib/mask/birefNet/poloCarpet.fixtureMap.test.ts` | Eight-fixture map |
| `src/components/ReviewDiagnosticsPanel.tsx` | ImageData safety, peel lifecycle, visual peel diff |
| `src/App.tsx` | Keep diagnostics mounted for peel undo |

**Unchanged:** stock `model_fp16.onnx` SHA `eff9216…`, default WASM preference, experimental rewrite under `tmp-model-eval/` / `experiments/`.

---

## 3. Resize warning: expected vs defect

| Kind | When | UI |
| --- | --- | --- |
| **Expected** | BiRefNet 512 logits bilinear → source W×H | `mask_resized` **info**, does **not** force review |
| **Suspicious** | Mask W/H ≠ requested source after postprocess | `mask_resized` uncertain + **forces review** |

---

## 4. Diagnostic preview / peel proof (automated)

- `buildDiagnosticOverlay` → `instanceof ImageData` (unit tests).
- Peel preview does not mutate store; apply+undo restores bytes (`lifecycle.regression.test.ts`).
- Panel: stale preview rejected; Undo survives apply via `peelUndoAvailable`.

Manual browser proof of the eight UI screenshots was not re-captured in this pass; unit/regression coverage targets the same code paths that threw `putImageData`.

---

## 5. Fixture map (screenshots → sources)

Sources: `tmp-model-eval/polo-carpet-hw-accel-2026-10-28/sources/`

| ID | Tags | Notes |
| --- | --- | --- |
| polo-1…4,7 | white polo / carpet / tape | Tape kept as photographed foreground |
| polo-5 | collar close-up | Fill-frame: do not force studio peel |
| polo-6, polo-8 | hard-case | Historical **manual-required**; must not silent-success |

Golden WASM fixtures (hoodie/tshirt/sneakers/handbag/polo-5): **KEEP% + SHA still match** after this remediation.

---

## 6. GPU/WASM `polo-6` status

| Item | Status |
| --- | --- |
| Prior WebGPU rewrite IoU | **0.874**, bg leak **2.14%** vs WASM rewrite |
| Implementation error found in production WASM indexing? | **No** |
| Threshold loosened to pass? | **No** |
| Rewrite enabled in production? | **No** |
| Ship rewrite? | **No** — remains experimental until IoU/leak gates + GPU golden policy |

---

## 7. Gate results

| Gate | Result |
| --- | --- |
| `npm test` | **PASS** 417 passed, 2 skipped |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** (pre-existing warnings) |
| `npm run build` | **PASS** |
| `npm run assert:birefnet-fixtures` | **PASS** (5/5 SHA+KEEP) |
| `npm run experiment:birefnet-webgpu-guard` | **PASS** |
| Stock checkpoint | Unchanged `eff9216…` / 98 484 532 |

---

## 8. Remaining limitations

1. **polo-6 / polo-8** absolute segmentation quality still often needs manual review (tape-only KEEP / hem/carpet).
2. Stretch-to-512 (no letterbox) still distorts non-square aspect — thin objects can lose detail below model resolution.
3. Textured border refine is conservative; heavy carpet bleed inside the silhouette may remain → review.
4. WebGPU rewrite **not** production-ready (`polo-6` disagreement + browser matrix).
5. DIS5K commercial licensing note unchanged.
6. True GPU device-loss injection still not exercised.

---

## 9. Ship verdict

**NOT APPROVED TO SHIP** as complete resolution of all eight visual scenarios / WebGPU enablement.

**Approved to merge as a remediation of deterministic defects** (ImageData overlay, resize warning semantics, peel lifecycle, false collar studio leak, conservative carpet peel, tests/gates) **while**:

- Production default remains **stock WASM BiRefNet**,
- Hard polo/carpet cases stay **review-gated**,
- Experimental WebGPU rewrite stays **disabled**.
