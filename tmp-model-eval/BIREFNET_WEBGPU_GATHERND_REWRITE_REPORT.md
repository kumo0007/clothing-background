# BiRefNet WebGPU GatherND graph rewrite (isolated experiment)

**Date:** 2026-10-28  
**Branch:** `experiment/birefnet-webgpu-graph-rewrite`  
**ORT Web:** `onnxruntime-web@1.21.0` (MIT)  
**Stock model (immutable):** `studioludens/birefnet-lite-512` FP16  
`eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516` · 98 484 532 bytes  

**Verdict: experimental rewrite meets acceptance on this host — not shipped to production.**

Production segmentation path, default model URL, preprocessing, thresholds, mask polarity, and postprocessing are **unchanged**. The rewritten ONNX lives only under `tmp-model-eval/…` and is served from an isolated URL in experiment harnesses.

---

## 1. Failure ops (stock graph)

| Op | Count | Pattern | WebGPU impact |
| --- | ---: | --- | --- |
| **GatherND** | **80** | data `[1,1,H,W,64]` FP16, indices `[1,1,N,2]` INT64, **`batch_dims=2`** | Rank ≥ 5 triggers Tint reject of `computeSliceOffsets` ([ORT #32731](https://github.com/microsoft/onnxruntime/issues/32731)) → KEEP=0 on stock WebGPU |
| **ScatterND** | **72** | mostly symbolic 4-D data + 5-D indices ending in `4` | Left **untouched**; not the #32731 failure mode. Stock WebGPU still failed before Scatter mattered. |
| Split | 0 | — | N/A (no Split fan-out on this export) |
| Concat | 659 | max fan-in **6** | Already under WebGPU buffer limits |
| Sum | 20 | max 4 inputs | Untouched; session still runs on WebGPU after GatherND rewrite |

Inspect artifacts: `tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/gathernd-inspect.json`

---

## 2. Runtime / upstream

- Installed: **ORT Web 1.21.0** — GatherND WebGPU shader bug present (same class as #32731; draft fix [PR #32733](https://github.com/microsoft/onnxruntime/pull/32733) **not merged** into this release).
- Classification: **known WebGPU EP provider defect** (invalid WGSL for packed uniform indexing when data rank ≥ 5), not a model-weight bug.
- Stock WebGPU (prior HW report): warm ~6.1 s but **KEEP=0** + `Invalid ComputePipeline "computeSliceOffsets"`.
- WebGL: still blocked by **FLOAT16** (unchanged; out of scope for this rewrite).

---

## 3. Semantics-preserving rewrite

**Feasible** for all 80 GatherND nodes with concrete shapes:

```
GatherND(data[1,1,H,W,C], idx[1,1,N,2], batch_dims=2)
  → Reshape data → [1,1,H*W,C]
  → Gather idx axes → y,x [1,1,N]
  → lin = y*W + x ; Reshape lin → [N]   # avoid Gather rank inflation
  → Gather(data_flat, lin, axis=2) → [1,1,N,C]
```

**Critical fix vs first attempt:** `Gather` with indices rank 3 on axis 2 of rank-4 data yields rank **6**. Indices must be squeezed to **`[N]`** so output matches GatherND `[1,1,N,C]`.

Approximate substitutes were **not** used. ScatterND / Sum / int64 paths left as-is for this experiment.

**Output:** `tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/model_fp16.gathernd_rewrite.onnx`  
SHA `7f0dfdabbb7a0c588bd4a1e155bb291b470cbd2030af7779fb47ec8514499f8e` · 98 510 727 bytes · **0 GatherND remaining** · 72 ScatterND untouched.

---

## 4. Numerical equivalence

### WASM stock vs WASM rewrite (logits + full-res masks)

Source: `wasm-equivalence.json`, `clothing-eval.json`

| Set | Result |
| --- | --- |
| 5 golden fixtures | **logit maxAbsDiff = 0**, masks bit-identical, KEEP% + SHA match `fixtureKeepBaseline` |
| Clothing 01–10 | **exact** masks vs stock (IoU=1, 0 false removal / bg leak) |
| Polo sources present | **exact** vs stock |

**Equivalence class (WASM):** exact bit-identical logits/masks.

### WebGPU rewrite vs WASM rewrite (model-res 512 keep masks)

Source: `webgpu-vs-wasm-compare.json`

| Fixture | IoU | False garment removal % | BG leakage % | Edge disagree px | KEEP ref→hyp |
| --- | ---: | ---: | ---: | ---: | --- |
| dark-hoodie | 0.9990 | 0.0298 | 0.0233 | 139 | 0.5543→0.5543 |
| white-tshirt | 0.9992 | 0.0134 | 0.0248 | 100 | 0.4901→0.4902 |
| white-sneakers | 0.9989 | 0.0149 | 0.0244 | 103 | 0.3450→0.3451 |
| open-handbag | 0.9984 | 0.0309 | 0.0275 | 153 | 0.3565→0.3564 |
| polo-5 | 0.9990 | 0.0679 | 0.0084 | 200 | 0.7387→0.7381 |

Logit mean AbsDiff ~0.29–0.46 (GPU FP16 path); **not bit-identical**.  
**Equivalence class (WebGPU):** **acceptable measured deviation** (IoU ≥ 0.998, KEEP≠0, no degenerate logits). No `computeSliceOffsets` Tint errors in rewrite WebGPU logs.

---

## 5. Latency / memory (Chrome, rewritten graph)

Source: `rewrite-ep-bench.json`  
Baseline stock WASM (prior HW report): warm **11 197 ms**, 5-img **57 709 ms**.

| EP (rewrite) | Cold init | Warm reuse | 5-img batch | Peak JS heap (after init) | meaningfulKeep |
| --- | ---: | ---: | ---: | ---: | --- |
| WASM | 13 695 ms | 10 196 ms | 53 488 ms | ~102 MB | true |
| **WebGPU** | **10 273 ms** | **5 338 ms** | **28 988 ms** | ~103 MB | **true** |

WebGPU warm ≈ **2.1×** faster than stock WASM baseline; batch ≈ **2.0×** faster. Stable run; no browser crash; heap peak comparable to WASM (~100 MB JS, GPU memory not fully visible via `performance.memory`).

---

## 6. Acceptance vs criteria

| Criterion | Status |
| --- | --- |
| No KEEP=0 / invalid masks | **Pass** (WebGPU rewrite) |
| No unacceptable garment loss | **Pass** (IoU ≥ 0.998; false removal ≤ 0.07%) |
| Reproducible improvement vs WASM ~11.2 s | **Pass** (~5.3 s warm WebGPU) |
| Stable memory / no crash | **Pass** on this host |
| Licensing documented | **Pass** (below) |
| Production path / default model unchanged | **Pass** + automated guard |

**Ship decision:** rewrite is **viable experimentally** but **not merged into production** in this pass (weights artifact change + WebGPU EP still experimental; requires product decision, browser matrix, and deploy packaging of a second ONNX).

---

## 7. Licensing / deployment implications

| Component | License | Note |
| --- | --- | --- |
| `onnxruntime-web` | MIT | Already in prod; WebGPU bundle already vendored in benches |
| Stock BiRefNet lite weights | MIT (code/weights) | DIS5K training-data commercial review remains a **separate** release policy item |
| Rewritten ONNX | Same weights, topology-only surgery | New artifact (~98.5 MB); must be versioned/hashed separately; **must not** overwrite `model_fp16.onnx` |
| Browser WebGPU | Platform API | Needs Chrome/Edge with WebGPU; COOP/COEP already used for WASM benches |

Deploying would mean: optional EP selection, dual-weight hosting or replace-with-rewrite **after** guard/SHA update, and acceptance of non-bit-identical GPU masks.

---

## 8. Automated guards (silent swap prevention)

```bash
npm run experiment:birefnet-webgpu-guard
```

`experiments/birefnet-webgpu-rewrite/assert_prod_model_untouched.mts` fails if:

- `BIREFNET_ONNX_FP16_*` constants drift from trusted LFS oid  
- Stock file SHA/size mismatch  
- Any `*gathernd*/*rewrite*/*webgpu*` file appears under `public/models/.../onnx/`  
- `session.ts` references experimental rewrite paths  
- `rewrite-meta.json` loses isolation note  

Also: `npm run experiment:birefnet-webgpu-equiv` (WASM stock vs rewrite).

---

## 9. Exact files changed / added (this experiment)

**Added (experiment only):**

- `experiments/birefnet-webgpu-rewrite/inspect_gathernd.py`
- `experiments/birefnet-webgpu-rewrite/inspect_scatternd.py`
- `experiments/birefnet-webgpu-rewrite/rewrite_gathernd.py`
- `experiments/birefnet-webgpu-rewrite/validate_cpu_equivalence.py` (native ORT crash on this host — superseded by WASM)
- `experiments/birefnet-webgpu-rewrite/validate_wasm_equivalence.mts`
- `experiments/birefnet-webgpu-rewrite/bench_rewrite_browser.mts`
- `experiments/birefnet-webgpu-rewrite/compare_webgpu_vs_wasm.mts`
- `experiments/birefnet-webgpu-rewrite/eval_rewrite_clothing.mts`
- `experiments/birefnet-webgpu-rewrite/assert_prod_model_untouched.mts`
- `package.json` scripts: `experiment:birefnet-webgpu-guard`, `experiment:birefnet-webgpu-equiv`
- Artifacts under `tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/`
- This report: `tmp-model-eval/BIREFNET_WEBGPU_GATHERND_REWRITE_REPORT.md`

**Explicitly unchanged:**

- `public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx` (still `eff9216…` / 98 484 532)  
- `src/lib/mask/birefNet/session.ts` (no rewrite URL)  
- Production preprocess / threshold / postprocess / App segmentation wiring for default EP  

---

## 10. Next viable experiments (if productizing)

1. **Package dual-EP:** ship rewrite ONNX + WebGPU prefer with WASM fallback; update SHA constants only after golden policy for GPU masks.  
2. **Upstream ORT:** bump when #32733 (or successor) lands — may make stock GatherND work without graph surgery.  
3. **Further graph hygiene (optional):** Sum→binary Add, int64→int32 index math (HF WebGPU ports) if CPU fallback or buffer limits appear on lower-end GPUs.  
4. **ScatterND audit:** confirm zero-size / no-op cases on all resolutions; Identity prune if needed (seen on other BiRefNet 512 ports).  
5. **Browser matrix + GPU memory** beyond `performance.memory`.
