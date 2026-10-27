# BiRefNet verification report (weights ready)

**Date:** 2026-10-27  
**No re-download performed** — existing file validated in place.

## 1. File validation

| Check | Result |
| --- | --- |
| App URL | `/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx` |
| Disk path | `public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx` |
| Size | **98 484 532** bytes (exact; not partial) |
| SHA-256 | `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516` |
| Trusted source | HF Git LFS pointer at `…/raw/main/onnx/model_fp16.onnx` (commit `962e6796…`) |
| Not LFS/HTML stub | yes |
| ORT load (WASM) | ok — inputs `input_image`, outputs `output_image`, dims `[1,1,512,512]` |
| Smoke infer | finite logits; blank zeros → all-negative range (expected for empty input) |
| `.mirror-meta.json` | `ready: true` — treated as **metadata only**, not integrity proof |

Artifact: `tmp-model-eval/birefnet-weight-validation/`  
`onnxruntime-node` DLL failed to load on this Windows host; validation used `onnxruntime-web` WASM (same stack as browser).

## 2. Real browser inference

Artifact: `tmp-model-eval/birefnet-browser-verify/` (fresh dual-context run)

| EP | Session | KEEP @512 (sneakers) | Logits | Cold / warm1 / warm2 |
| --- | --- | ---: | --- | --- |
| **WebGPU** | creates + runs | **0** (degenerate) | raw ≈ [-4.28, -1.83]; WebGPU validation errors (`computeSliceOffsets`) | 11.8s / 9.2s / 6.1s |
| **WASM** | creates + runs | **0.345** | raw ≈ [-19.1, +18.3]; polarity center≫border | 15.8s / 14.5s / 12.3s |

- Method id always `birefnet-lite-512` (not silent RMBG).
- Mask polarity convention in app path: `255=KEEP`, `0=BG` via sigmoid + resize.
- App default: **WASM** (`VITE_BIREFNET_WEBGPU=1` to force WebGPU); degenerate WebGPU logits trigger WASM rebuild before RMBG fallback.
- Fallback diagnostics (`fallbackFrom` / `fallbackReason`) covered by unit tests for BiRefNet→RMBG path.

## 3. Fixture benchmark (heuristic ref IoU — not GT)

Output dir (does **not** overwrite prior baseline):  
`tmp-model-eval/birefnet-bench-rerun-2026-10-27/`

Provider: onnxruntime-web **WASM** (Node harness). Cold session ≈ **10.9 s**; mean warm BiRefNet ≈ **7.4 s**.

| Fixture | BiRef keep% | BiRef IoU† | Lab IoU† | RMBG IoU† | BiRef ms | RMBG ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 01_hoodie | 55.43 | 0.906 | **0.989** | 0.910 | 7696 | 4376 |
| 02_blazer | 55.84 | 0.965 | **0.985** | 0.965 | 7192 | 4280 |
| 03_tshirt | 49.04 | 0.050 | 0.031 | **0.158** | 6917 | 4219 |
| 04_jeans | 36.04 | 0.902 | **0.941** | 0.927 | 6906 | 4802 |
| 05_coat | 39.25 | 0.932 | **0.959** | 0.931 | 7337 | 4935 |
| 06_sweater | 46.95 | 0.876 | **0.894** | 0.877 | 7612 | 3681 |
| 07_dress | 19.02 | 0.867 | **0.906** | 0.869 | 7338 | 4242 |
| 08_sneakers | 34.50 | 0.213 | **0.453** | 0.209 | 7393 | 4348 |
| 09_handbag | 35.68 | 0.951 | 0.946 | **0.954** | 7637 | 4292 |
| 10_cap | 25.57 | 0.847 | **0.908** | 0.843 | 7968 | 4692 |

† vs appearance+border **reference heuristic**, not pixel-perfect ground truth. Visuals: `magenta/`, `beige/`, `transparent/`, `masks/`.

**Honest quality takeaway:** Lab-seed wins most IoU scores on this ref; BiRefNet ≈ RMBG on several garments; white tee / sneakers remain hard for all three. **Do not claim BiRefNet is overall superior** from these numbers alone — inspect cutouts for handles/halos before product claims.

## 4. Regression

| Gate | Result |
| --- | --- |
| typecheck | pass |
| tests | **394** passed, 1 skipped |
| lint | pass (existing warnings only) |
| production build | pass |

BiRefNet remains default when weights are ready; RMBG selectable; missing/degenerate paths report explicitly.

## 5. Remaining issues / next actions

1. **WebGPU** on this Chrome adapter is unusable for this ONNX (degenerate logits + validation errors). Keep WASM default until a known-good adapter is confirmed.
2. Optional: human visual review of `birefnet-bench-rerun-2026-10-27/transparent/{08_sneakers,09_handbag,03_tshirt}-cutout.png` for handle holes / white-on-white.
3. `onnxruntime-node` native binding still broken here — use web WASM for Node-side checks.
