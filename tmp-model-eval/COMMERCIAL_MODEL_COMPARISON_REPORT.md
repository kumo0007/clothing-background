# Commercial local background-removal model — evaluation report

**Date:** 2026-10-26  
**Verdict:** **Do not switch production default.** Keep `bg-remove-sdk` + RMBG-1.4 for non-commercial/eval use. **Commercial release remains blocked** by BRIA RMBG-1.4 licensing until a BRIA agreement or a quality-acceptable Apache/MIT-cleared alternative is adopted.

---

## 1. License gate (completed before weight download)

| Candidate | Code / weights license | Commercial rights established? | Action |
| --- | --- | --- | --- |
| **RMBG-1.4** (current) | SDK MIT; weights `bria-rmbg-1.4` non-commercial/eval | **No** without BRIA agreement | Stay for technical path only |
| **U²-Netp** | Upstream Apache-2.0 (author: codes **and** models); rembg mirror Apache-2.0 | **Yes** (subject to Apache notices; DUTS dataset counsel flag) | Eligible → **benchmarked** |
| **BiRefNet-lite 512** | Declared MIT; trained on **DIS5K** (commercial dataset ToU unresolved for weights) | **No** | **Not downloaded** |
| MODNet / IMG.LY ISNet | Portrait fit / **AGPL-3.0** | No for intended SaaS | Excluded |

Full evidence: `tmp-model-eval/LICENSE_REVIEW.md`.

**Pinned U²-Netp artifact (downloaded only after license doc):**

| Field | Value |
| --- | --- |
| Path | `tmp-model-eval/weights/u2netp.onnx` |
| Size | 4 574 861 bytes (~4.36 MiB) |
| SHA-256 | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` |
| Source | https://huggingface.co/edgetools/u2netp (rembg-compatible) |
| Upstream license text | `tmp-model-eval/weights/LICENSE-U2-Net-Apache-2.0.txt` |

---

## 2. Benchmark method

| Item | Detail |
| --- | --- |
| Fixtures | Same 10 clothing JPEGs: `public/testdata/clothing/01_hoodie.jpg` … `10_cap.jpg` |
| Harness | `scripts/benchmarkU2netp.mts` → `tmp-model-eval/u2netp-bench/` |
| Pre/post | rembg-compatible ImageNet normalize, 320² NCHW, first ONNX output min–max → soft alpha |
| Runtime | `onnxruntime-web` Node WASM (browser-class stack; WebGPU not required for this Node run) |
| Metrics | Definite-label IoU vs appearance+border reference; soft%; components; hole proxy; Lab-seed baseline on same refs |
| Visual | Magenta / beige / transparent / mask exports under `u2netp-bench/` |

**BiRefNet-lite:** not run (license gate failed).

**RMBG side-by-side masks:** not re-exported in Node (SDK is browser worker/WebGPU). Live RMBG fixture metrics from `tmp-release-validation/` used as the production quality bar.

---

## 3. Quantitative results (U²-Netp)

| Fixture | U² IoU | Lab IoU | soft% | edgeAcc | softα MAE | bg contam | holes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 01_hoodie | 0.906 | **0.989** | 11.8 | 0.57 | 0.42 | 0.037 | 0 |
| 02_blazer | 0.968 | **0.985** | 5.4 | 0.77 | 0.28 | 0.003 | 0 |
| 03_tshirt | 0.056† | 0.031† | 8.2 | 0.08† | 0.79† | 0.017 | 0 |
| 04_jeans | 0.917 | **0.941** | 10.0 | 0.59 | 0.42 | 0.024 | 0 |
| 05_coat | 0.934 | **0.959** | 5.4 | 0.79 | 0.27 | 0.026 | 0 |
| 06_sweater | 0.880 | **0.894** | 5.8 | 0.45 | 0.59 | 0.001 | 0 |
| 07_dress | 0.873 | **0.906** | 4.9 | 0.34 | 0.69 | 0.001 | 0 |
| 08_sneakers | 0.215† | **0.453**† | 10.1 | 0.77 | 0.22 | **0.231** | 0 |
| 09_handbag | **0.955** | 0.946 | 11.3 | 0.51 | 0.51 | 0.000 | **16** |
| 10_cap | 0.847 | **0.908** | 5.6 | 0.44 | 0.61 | 0.000 | 0 |

† White-on-near-white refs mark much of FG/BG as UNCERTAIN or disagree with silhouette IoU — treat binary scores cautiously; rely on visual + soft%/contamination.

**Timing / size (this machine, Node WASM):**

| Metric | U²-Netp | Production RMBG (browser, prior audit) |
| --- | --- | --- |
| Weight download | **~4.4 MiB** | ONNX FP16 cold ~**155 s** HF download |
| Session create | ~456 ms | Warm init ~6–7 s |
| Mean warm infer | ~**696 ms**/image | Warm process ~3–4 s/image (incl. pipeline) |
| Components | 1 on all 10 | Coherent (live review silent on small fixtures) |

---

## 4. Visual / hard-case QA (U²-Netp)

| Case | Observation |
| --- | --- |
| White tee | Coarse silhouette OK on magenta; soft fringe; collar hole imperfect; **not** shown superior to live RMBG |
| White sneakers | Outer shape OK; **23% definite-BG contamination**; soft sole/lace fringe; blue footer risk |
| Thin dress straps | Straps mostly present; **edgeAcc 0.34**, high softα MAE — fragile vs catalog AA needs |
| Handbag handles | Outer bag clean; **16 hole-error pixels** — openings not fully cleared |
| Dark knits (hoodie/sweater) | Usable body cutout; **soft% 6–12%** halo risk on fleece/rib |
| Soft-alpha vs RMBG | Live RMBG tee/sneaker soft% ~**3.3 / 4.4**; U² often **5–12%** — softer, less catalog-hard |

---

## 5. Architecture / integration decision

| Gate | Result |
| --- | --- |
| Commercial rights | U²-Netp **pass**; BiRefNet-lite **fail** |
| Clothing cutout quality vs current RMBG bar | **Fail** — worse soft-alpha discipline, worse Lab IoU on 8/10, sneaker BG leak, handle holes |
| Switch production default? | **No** |
| Wire U² as silent fallback / hosted API? | **No** (forbidden) |
| Code changes to `segmentWithBgRemoveSdk` / App default? | **None** — RMBG path left intact |

Optional later (out of scope for adoption): experimental opt-in behind an explicit non-default flag after further matte cleanup — **not** enabled now.

---

## 6. Browser compatibility notes

- U²-Netp ONNX runs under `onnxruntime-web` (already a dependency) — WASM verified in Node; WebGPU path feasible in browser with the same weights.
- Memory: ~4.4 MiB weights + 320² activations — favorable vs RMBG for mobile-class devices.
- Batch stability on physical phones: **not** re-measured for U² (no production switch). Prior mobile batch work remains on RMBG.

---

## 7. Remaining commercial blocker

1. **Primary:** RMBG-1.4 weights require a BRIA commercial agreement for catalog/SaaS release.  
2. **Alternatives:** BiRefNet-lite blocked until DIS5K↔weights counsel clearance.  
3. **U²-Netp:** Licensed OK, **quality not acceptable** as drop-in replacement for the current neural path without additional matte post-processing and a demonstrated parity audit vs live RMBG on the same fixtures.

---

## 8. Reproduction

```bash
# License doc must exist first (already written).
npx vite-node scripts/benchmarkU2netp.mts
# → tmp-model-eval/u2netp-bench/{summary.json,BENCHMARK.md,masks,magenta,beige,transparent}
```

Existing app gates (unchanged default): `npm run typecheck`, `lint`, `test`, `build`.
