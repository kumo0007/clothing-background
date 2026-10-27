# BiRefNet quality & performance diagnosis

**Date:** 2026-10-27  
**Scope:** Audit pre/post vs checkpoint; raw vs cleanup; WASM staging; WebGPU status.  
**Artifacts:** `tmp-model-eval/birefnet-diagnose-2026-10-27/` (does not overwrite `birefnet-bench-rerun-2026-10-27/`).

## Verdict

**Preprocessing and postprocessing match the studioludens BiRefNet_lite 512 checkpoint.** Remaining fixture IoU gaps vs Lab-seed are primarily **model / heuristic-metric limitations**, not inverted polarity or a missing sigmoid. One **confirmed pipeline defect** was found: `repairSdkUnderRecall` damages healthy BiRefNet masks — removed from the BiRefNet segment path only.

Do **not** claim BiRefNet is overall better than Lab-seed: prior bench still shows Lab-seed ahead on most heuristic IoU scores.

## 1. Pre/post contract (confirmed correct)

| Item | Checkpoint / reference | App | Status |
| --- | --- | --- | --- |
| RGB order | ViTFeatureExtractor RGB | ImageData R,G,B → NCHW | OK |
| Rescale | `1/255` | `pixel/255` | OK |
| Mean / std | ImageNet `[0.485,0.456,0.406]` / `[0.229,0.224,0.225]` | `BIREFNET_*` constants | OK |
| Resize | PIL resample=2 (BILINEAR), 512² | Bilinear half-pixel → 512² | OK |
| Layout / dtype | NCHW float → FP16 ONNX | float32 tensor; ORT casts | OK |
| Output | Logits; README: apply sigmoid externally | `sigmoid` then soft α → 8-bit | OK |
| Polarity | FG positive logits | 255=KEEP, 0=BG | OK |

Deterministic contract tests added in `src/lib/mask/birefNet/birefNet.test.ts`.

**Not claimed as defects:** half-pixel vs PIL pixel-center micro-differences; float32 input to FP16 weights (standard ORT cast).

## 2. Raw vs cleanup (confirmed defect → fixed)

Under-recall repair was applied on every diagnosed fixture and **lowered** heuristic IoU while growing KEEP:

| Fixture | Raw IoU† | After repair IoU† | ΔIoU | Binary Δ% | Repair trigger |
| --- | ---: | ---: | ---: | ---: | --- |
| 01_hoodie | 0.906 | 0.851 | −0.056 | 4.96 | thin-keep-corridor |
| 03_tshirt | 0.050 | 0.030 | −0.020 | 4.27 | thin-keep-corridor |
| 06_sweater | 0.876 | 0.842 | −0.035 | 5.00 | thin-keep-corridor |
| 08_sneakers | 0.213 | 0.198 | −0.016 | 4.49 | pale-gap |
| 09_handbag | 0.951 | 0.873 | −0.078 | 11.33 | pale-gap |
| 10_cap | 0.847 | 0.799 | −0.048 | 3.26 | pale-gap |

† vs appearance+border heuristic — not GT.

**Fix:** `segmentWithBirefNet` no longer calls `repairSdkUnderRecall` (helper remains for RMBG / bg-remove-sdk under-recall). Prior Node bench already scored **raw** masks, so published IoU tables are unchanged by this fix; **production BiRefNet quality improves** by not bloating soft edges.

### Per-fixture quality attribution (honest)

| Fixture | Primary cause of poor / uneven scores |
| --- | --- |
| 01_hoodie, 06_sweater, 09_handbag, 10_cap | Raw BiRefNet usable; Lab-seed still higher IoU on most. Cleanup previously damaged BiRefNet. |
| 03_tshirt | **Genuine model / metric limitation** (white-on-light); all methods weak. |
| 08_sneakers | **Genuine hard case** (white-on-light); cutout silhouette coherent visually; heuristic IoU low for all. Not preprocess inversion. |
| WebGPU path | **Runtime defect** (degenerate logits) — disabled. |

## 3. WASM performance (measured)

Node `onnxruntime-web` WASM (sneakers), staged:

| Config | Init | First infer | Mean warm infer | Prep | Post | Repair |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| wasm-default | 9718 | 7408 | **7091** | ~20 | ~10 | ~46 |
| wasm-numThreads-1 | 8750 | 6916 | **6906** | ~23 | ~13 | ~48 |

- Latency is dominated by **warm ONNX infer (~6.9–7.1 s)**, not prep/post/repair.
- Safe tweak applied: when **not** `crossOriginIsolated`, set `ort.env.wasm.numThreads = 1` (no COOP/COEP requirement; slight win here).
- Session remains shared (no repeated model init per image).
- **Not** reducing 512 input solely for speed — quality tradeoff not taken.

Hypothesis (not proven on devices): browser with COI + multi-thread WASM could improve further; out of scope without isolation headers.

## 4. WebGPU (remains disabled)

**Confirmed:** Chrome adapter creates a session but emits degenerate all-negative logits + `computeSliceOffsets` validation errors → empty KEEP. Likely FP16 / graph op / adapter incompatibility for this ONNX — not a simple tensor-name misconfig (WASM works with the same feeds).

Production default stays WASM; `VITE_BIREFNET_WEBGPU=1` still falls back when logits look degenerate. Do not enable WebGPU until regression fixtures match WASM.

## 5. Worth retaining?

| Criterion | Finding |
| --- | --- |
| Technically correct I/O | **Yes** (contract + tests) |
| Better than Lab-seed overall | **No** on current heuristic IoU |
| Competitive with RMBG | Roughly similar on prior bench |
| Latency | ~7 s warm WASM — usable but slow for interactive batch |
| Retain as optional/default ONNX path | **Yes, with eyes open** — MIT browser weights work; Lab-seed still wins many fixtures; white garments stay hard |

## 6. Post-diagnose bench (raw path, new dir)

`tmp-model-eval/birefnet-bench-post-diagnose-2026-10-27/` — does **not** overwrite `birefnet-bench-rerun-2026-10-27/`.

IoU matches the prior raw-mask bench (Lab-seed still ahead on most fixtures). Mean warm BiRefNet ≈ **7.4 s**. Visual cutouts unchanged vs prior raw output.

## 7. Regression gates

| Gate | Result |
| --- | --- |
| typecheck | pass |
| tests | **399** passed, 1 skipped |
| lint | pass (existing warnings only) |
| production build | pass |

## 8. Changes made (evidence-backed only)

1. Contract tests for ImageNet normalize, RGB NCHW, sigmoid KEEP polarity, `alreadyProbability`.
2. Skip `repairSdkUnderRecall` in BiRefNet `segment.ts`.
3. Pin WASM `numThreads=1` when not cross-origin isolated.
4. Diagnosis artifacts + this report.

No app rewrite, no Lab-seed replacement, no new model, WebGPU still off.
