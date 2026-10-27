# BiRefNet hardware-accelerated EP investigation

**Date:** 2026-10-28  
**ORT Web:** `onnxruntime-web@1.21.0` (MIT)  
**Model under test:** stock `studioludens/birefnet-lite-512` FP16 (`eff9216…`, 98 484 532 bytes)  
**Production path:** **unchanged** (WASM default; no EP switch, no weight/preprocess/threshold edits)

Artifacts: `tmp-model-eval/birefnet-hw-accel-2026-10-28/`  
Harness (isolated): `scripts/benchBirefNetHwAccel.mts`, `scripts/birefnet-ep-bench-harness.html`, `scripts/inspectBirefNetOnnxOps.mts`, `scripts/runBirefNetClothingSweep.mts`

---

## Verdict

**No candidate meets acceptance** (faster warm inference **and** usable segmentation on the **stock** checkpoint).

| EP | Cold | Warm / batch | Segmentation vs WASM | Accept? |
| --- | ---: | --- | --- | --- |
| **WASM** (baseline) | 14 499 ms | warm reuse **11 197 ms**; 5-img **57 709 ms** | KEEP% + golden SHA match | Production (keep) |
| **WebGPU** | 10 912 ms | warm reuse **6 137 ms**; 5-img **32 649 ms** (~1.8× wall) | **KEEP=0 all five**; logits all-negative; `computeSliceOffsets` Tint errors | **Reject** |
| **WebGL** | — | — | Session create fails: **`unsupported data type: FLOAT16`** | **Reject** |

WebGPU is faster but **unusable** on this graph. WebGL cannot load FP16. Production stays on WASM.

---

## 1. ORT 1.21 EP support (installed)

From `node_modules/onnxruntime-web`:

- Bundles: `ort.min.mjs` (WASM), `ort.webgpu.min.mjs`, `ort.webgl.min.mjs`, JSEP WASM artifacts  
- Runtime env keys: `wasm`, `webgl`, `webgpu`  
- License: **MIT** (no extra runtime dependency beyond current `onnxruntime-web`)

No new packages were added for this investigation.

---

## 2. Stock BiRefNet compatibility

ASCII ONNX scan (`onnx-ops-inspect.json`): many `GatherND` / `ScatterND` markers (deformable-attention path).

Known ORT issue **#32731**: WebGPU GatherND rank ≥ 5 emits invalid WGSL (`i32(vec4<u32>)`) in `computeSliceOffsets`. BiRefNet lite is a documented real-world impact case. Logs from this host match exactly.

| Candidate | Stock FP16 compatibility |
| --- | --- |
| WASM | Full — production |
| WebGPU | Session creates; **GatherND shader invalid → degenerate logits** |
| WebGL | **No FLOAT16** support in ORT Web 1.21 WebGL EP |

Rewritten “WebGPU-ready” BiRefNet graphs exist upstream (graph surgery, sometimes different I/O size). Using them would **change the ONNX graph / weights artifact** and is **out of scope** for this pass (must preserve stock checkpoint + golden hashes).

---

## 3. Isolated benchmarks (Chrome, stock model)

Source: `ep-bench.json`

### WASM

- Cold: **14 499 ms**  
- Warm reuse: **11 197 ms**  
- 5-fixture batch infer: **57 709 ms** (~11.2–12.1 s each)  
- meaningfulKeep: **true**  
- Heap after init ≈ **102 MB** used (`performance.memory`)

### WebGPU

- Cold: **10 912 ms**  
- Warm reuse: **6 137 ms**  
- 5-fixture batch: **32 649 ms** (faster wall clock)  
- **keepRatio = 0**, softRatio = 1, rawMax &lt; 0 on every fixture  
- Logit fingerprint ≠ WASM; α sample ~0.05 everywhere  
- Console: repeated `Invalid ComputePipeline "computeSliceOffsets"`

### WebGL

- `createError`: **`unsupported data type: FLOAT16`**  
- No inference timings

**Acceptance failure:** speed without valid masks does not qualify.

---

## 4. Mask / logits comparison vs WASM

| Fixture (model-res KEEP proxy) | WASM keepRatio | WebGPU keepRatio | Notes |
| --- | ---: | ---: | --- |
| dark-hoodie | 0.5543 | 0 | WebGPU degenerate |
| white-tshirt | 0.4901 | 0 | |
| white-sneakers | 0.3450 | 0 | |
| open-handbag | 0.3565 | 0 | |
| polo-5 | 0.7387 | 0 | |

Full-resolution golden masks (Node WASM sweep): **all five KEEP% + SHA-256 match** `fixtureKeepBaseline.ts`.

---

## 5. Broader clothing + polo carpet set (WASM only)

`clothing-sweep.json` + cutouts under `clothing/` and `polo/`.

- Clothing 01–10: dims match, RGB intact, infer ~11.3–11.7 s  
- Polo 1–8: completed; **polo-6 / polo-8** low KEEP (~15–17%) — hem/tape close-ups where BiRefNet mostly keeps the tape (known hard case; prior polo final report marked similar shots manual-required). **Not a production-path bug.**  
- Golden fixtures: **shaOk / keepOk true**

---

## 6. Licensing / deployment

| Component | License | Note |
| --- | --- | --- |
| `onnxruntime-web` | MIT | Already in production |
| BiRefNet lite export | MIT weights | DIS5K training-data commercial review still a **separate** release policy item |
| WebGPU / WebGL | Browser APIs | No extra npm dep |

Enabling WebGPU in production would still need a **compatible ONNX graph** (or ORT fix) — not just flipping `executionProviders`.

---

## 7. Production changes

**None.** App / `session.ts` still default WASM. Experimental scripts only.

Gates after investigation: typecheck / **403** tests / lint / build / `validate:birefnet-weights` / `assert:birefnet-fixtures` — pass. Client chunk `birefNet-uWrAHT8V.js` unchanged.

---

## 8. Recommended next experiment (not done here)

1. **Isolate a graph-rewritten BiRefNet** (GatherND→Gather, Split trees, etc.) that keeps **512 I/O + same ImageNet preprocess**, then measure WebGPU warm latency **and** mask SHA / IoU vs current goldens.  
2. Or wait for ORT WebGPU GatherND rank-5 fix (**#32733**) and re-bench **stock** FP16.  
3. Do **not** ship WebGPU until masks match goldens (or an explicitly accepted new golden set after human review).

---

## Reproduce

```bash
npx tsx scripts/inspectBirefNetOnnxOps.mts
npm run build
npx tsx scripts/benchBirefNetHwAccel.mts
npx tsx scripts/runBirefNetClothingSweep.mts
npm run assert:birefnet-fixtures
```
