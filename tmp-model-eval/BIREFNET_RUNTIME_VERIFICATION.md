# BiRefNet runtime verification & quality benchmark

**Date:** 2026-10-27  
**Checkpoint:** `studioludens/birefnet-lite-512` / `onnx/model_fp16.onnx`  
**SHA-256:** `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516` (98 484 532 bytes)  
**License file (mirrored):** MIT — Copyright ZhengPeng (2024) + Studio Ludens V.O.F. (2026)  
**Upstream code:** ZhengPeng7/BiRefNet (MIT). Training data includes DIS5K (separate ToU — **not** commercially cleared here).

---

## 1. Weight download

| Item | Result |
| --- | --- |
| Failure mode | DNS timeouts / connect timeout / mid-transfer `schannel` reset to HF LFS |
| Fix | Atomic `.part` → rename, SHA-256 gate, resume (`Range`), `HF_ENDPOINT` / timeout / retry env, `.mirror-meta.json` `ready` flag |
| Manual procedure | `tmp-model-eval/BIREFNET_WEIGHT_FETCH.md` |
| This host | Weights **obtained and validated** after resume download |

Build does **not** treat incomplete weights as ready (`ready: false` + soft warn unless `BIREFNET_FETCH_STRICT=1`).

Runtime probes FP16 via exact `Content-Length === 98484532` so truncated files are not treated as available.

---

## 2. Browser inference (Chromium)

Artifact: `tmp-model-eval/birefnet-browser-verify/`

| Field | Measured |
| --- | --- |
| Method id | `birefnet-lite-512` (not silently RMBG) |
| Provider used | **WASM** |
| Cold session | ~14.6 s |
| Warm infer #1 / #2 | ~12.6 s / ~11.9 s |
| KEEP ratio @512 (sneakers) | **0.345** |
| Logits | finite; rawMin≈−19.1 rawMax≈+18.3; sigmoid applied |
| Polarity | center ≫ border |
| WebGPU | Available but **degenerate** on this adapter (prior probe: rawMin≈−4.28…−1.83, keepRatio=0). App defaults to WASM; optional `VITE_BIREFNET_WEBGPU=1` with automatic WASM retry on degenerate logits. |

Commands: `npm run build` then `npm run verify:birefnet-browser`.

---

## 3. Quality benchmark (fixtures 01–10)

Artifact: `tmp-model-eval/birefnet-bench/`  
Harness: Node `onnxruntime-web` WASM (browser-class) + Lab-seed pipeline + RMBG-1.4 q8 ONNX probe.

| Fixture | BiRef keep% | BiRef IoU† | Lab IoU† | RMBG IoU† | BiRef ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 01_hoodie | 55.43 | 0.906 | 0.989 | 0.910 | 7837 |
| 02_blazer | 55.84 | 0.965 | 0.985 | 0.965 | 7063 |
| 03_tshirt | 49.04 | 0.050 | 0.031 | 0.158 | 7319 |
| 04_jeans | 36.04 | 0.902 | 0.941 | 0.927 | 6701 |
| 05_coat | 39.25 | 0.932 | 0.959 | 0.931 | 7018 |
| 06_sweater | 46.95 | 0.876 | 0.894 | 0.877 | 6816 |
| 07_dress | 19.02 | 0.867 | 0.906 | 0.869 | 6848 |
| 08_sneakers | 34.50 | 0.213 | 0.453 | 0.209 | 7038 |
| 09_handbag | 35.68 | 0.951 | 0.946 | 0.954 | 7078 |
| 10_cap | 25.57 | 0.847 | 0.908 | 0.843 | 7083 |

† vs appearance+border **heuristic reference**, not pixel-perfect GT — treat as comparative. Visuals under `birefnet-bench/{magenta,beige,transparent,masks}/`.

Cold session (Node WASM): ~10 s. Mean warm BiRefNet infer: ~7.1 s. RMBG Node probe warm: ~3.5–4.3 s.

**Do not claim BiRefNet is superior overall.** Lab-seed IoU is higher on most fixtures; white tee / sneakers IoU is unreliable for all backends; inspect sneakers/handbag cutouts before changing product guidance.

---

## 4. How to select / what UI reports

Batch → **Masking model** → BiRefNet (default) or RMBG-1.4.  
Mask status shows actual `methodUsed` (`birefnet-lite-512` or `bg-remove-sdk-rmbg1.4`). BiRefNet→RMBG fallback records reason + `needsReview`.

---

## 5. Regression suite (post-fix)

Re-run: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` (see session log after this report).
