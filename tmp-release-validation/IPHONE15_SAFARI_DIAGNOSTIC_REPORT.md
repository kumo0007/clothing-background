# iPhone 15 Safari auto-mask — diagnostic report

**Date:** 2026-10-26 (WASM OOM pass)  
**Client:** Safari on iPhone 15  
**Production model:** unchanged id — `bg-remove-sdk` + BRIA `briaai/RMBG-1.4`  
**Production deploy:** `garment-background-studio-hp2vdkwc8-tomsmit1107s-projects.vercel.app` → https://garment-background-studio.vercel.app/  
**Physical iPhone 15 validation:** **NOT PERFORMED** (no device on this agent)

---

## Latest client error (after WebGPU→WASM preference)

```text
Model init failed (no available backend found. ERR: [wasm] RangeError: Out of memory).
```

This is **ORT WASM backend / session bring-up**, not per-image inference and not a missing weight download. The `[wasm]` tag comes from ONNX Runtime’s `no available backend found` aggregator when `backend.init('wasm')` throws `RangeError: Out of memory` (typical Safari failure allocating a large contiguous WASM/JS buffer while constructing the session).

---

## Root cause

| Factor | Evidence |
| --- | --- |
| Stage | Init — WASM EP `init()` / model session load (message is backend ERR, before process stages) |
| Why fp16 hurts | App/SDK passed `dtype: 'fp16'` (~88 MB). transformers.js **defaults WASM → q8**; forcing fp16 on WASM inflates heap during session create |
| Concurrency | Single shared `BgRemover` (good); eager preload on upload could still overlap decode of 8 large JPEGs on iPhone |
| Duplicate sessions | Not indicated; recover disposes the worker. Immediate WASM retry after WebGPU failure could leave peak memory until GC |
| Not assumed | “Device simply has insufficient RAM” without identifying the allocation — the failing allocation is **WASM backend/session init**, not an arbitrary heap ceiling bump |

---

## Fix (smallest safe, same model id)

| Change | Detail |
| --- | --- |
| Apple-mobile WASM dtype | Prefer **`q8`** (quantized artifact of the same `briaai/RMBG-1.4` repo — transformers.js WASM default) |
| fp16 WASM OOM retry | One recover + retry with **q8** if init still reports `[wasm] Out of memory` |
| Memory hygiene | `yieldForWasmMemoryPressure()` before WASM init / after dispose; **skip eager preload on Apple mobile** until Auto-mask |
| Diagnostics | `init_stage` (download / runtime / session), `init-oom` failure stage, backend_select includes dtype |
| Unchanged | `bg-remove-sdk` package, model id, on-device only, serial batch, manual edit / export / Retry |

---

## Tests & build

| Check | Result |
| --- | --- |
| Device/dtype/OOM classifiers | Unit tests |
| WASM fp16 OOM → q8 retry | Unit test |
| iPhone UA → `device: 'wasm'`, `dtype: 'q8'` | Unit test |
| `npm run typecheck` | **Pass** |
| `npm test` | **Pass** (338 tests) |
| `npm run build` | **Pass** |

---

## Physical device

| Check | Status |
| --- | --- |
| iPhone 15 Safari · 8 images · Auto-mask all · no OOM | **PENDING / NOT PERFORMED** |

Record PASS/FAIL with iOS version when a physical device is available. Do **not** treat desktop or unit tests as device proof.

---

## Claim status

| Claim | Status |
| --- | --- |
| OOM localized to WASM backend/session init under fp16 | **Yes (code-level)** |
| Fix prefers/retries q8 for same RMBG-1.4 on mobile WASM | **Yes (in repo)** |
| 8/8 images on physical iPhone 15 Safari | **Not verified** |
