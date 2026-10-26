# iPhone 15 Safari auto-masking stall — diagnostic report

**Date:** 2026-10-26  
**Client report:** iPhone 15 · Safari · 8 JPEGs · `Auto-mask all` shows  
`Auto-masking 1/8: IMG_6651.jpeg (Running model...)` with **0 masked / 8 pending**.  
Recording does not establish whether processing eventually completes.

**Production model:** unchanged — `bg-remove-sdk` + BRIA RMBG-1.4.

---

## 1. What `Running model…` means

In `bg-remove-sdk` the worker emits `process:progress` stages:

1. `Preparing…`  
2. **`Running model…`** ← ONNX inference in the Web Worker  
3. `Composing output…`

The app surfaces that stage in the batch progress line. So the UI string means **first-image inference is in progress** (or hung), **not** the initial ~88 MB weight download.

Cold download is shown earlier as `Downloading model weights…` / `Loading local background-removal model…` via `preload()` / `sdk-init`. Reaching `Running model…` implies preload already resolved for that session (or `process()` triggered init that then entered the process stages).

---

## 2. Execution path (code)

| Step | Code | Notes |
| --- | --- | --- |
| Tap Auto-mask all | `App.runLocalAutoMask('all')` | Serial queue, concurrency 1 |
| Queue | `buildAutoMaskQueue` | Pending + failed only |
| Model warm | `preloadBgRemoveModel` | Shared remover; timeout **180s** |
| Per image | `autoMaskCornersForImage` → `segmentWithBgRemoveSdk` | Downscale long edge (mobile **1600**) |
| Inference | `remover.process(...)` | Timeout **120s**; stages → UI |
| Success | `setMask` + `processingPhase: masked` | Increments masked count |
| Failure | `autoFailed` + `failed` phase | Batch continues to next id |

Backend: SDK `device: 'auto'` → **WebGPU when available, else WASM** (Safari/iOS often WASM unless WebGPU is enabled).

---

## 3. Root cause

### Confirmed (code + SDK behavior) — not yet reproduced on a physical iPhone 15

| Finding | Evidence |
| --- | --- |
| **A. Misleading counters** | `countPendingMasks` previously counted **in-flight** images as pending. While image 1 showed `Running model…`, the UI could still show **8 pending / 0 masked**, matching the client screenshot language even when work was underway. |
| **B. Hung worker blocks the batch after app-level timeout** | `withTimeout` rejects the app promise, but `bg-remove-sdk` serializes `process()` on an internal queue and does **not** cancel the worker job. A hung first inference left later images waiting on that queue indefinitely. |
| **C. Ambiguous client symptom** | Without device logs or a completed recording, we **cannot** prove whether the session was (1) slow legitimate WASM inference, (2) a hung WebGPU/WASM worker, (3) Safari tab suspension, or (4) still downloading before the stage string appeared. |

**Verdict:** Root cause of the *client’s specific hang* remains **undetermined on device**. Two concrete product defects that amplify or prolong the symptom were fixed in-repo (A, B). This is **not** claimed as a verified iPhone 15 Safari fix.

---

## 4. iOS Safari risks (assessed, not assumed causative)

| Risk | Assessment |
| --- | --- |
| WebGPU vs WASM | SDK auto-selects; device shown in progress/diagnostics after ready |
| ~88 MB cold download | Covered by 180s preload timeout; separate from `Running model…` |
| Long first inference on WASM | Plausible on phone; 120s process timeout; heartbeat UI added |
| Tab background / Safari suspension | Timers and workers can stall; copy now urges keeping the tab open |
| Memory / large JPEGs | Mobile long-edge cap 1600; OOM mapped to actionable error |
| MIME / HEIC | JPEG path used by client; HEIC still unsupported |

---

## 5. Changes made

| File | Change |
| --- | --- |
| `src/lib/mask/bgRemoveSdk.ts` | `recoverSharedBgRemover` after init/process failure/timeout; process heartbeat; diagnostics hooks; clearer timeout copy |
| `src/lib/mask/bgRemoveDiagnostics.ts` | Privacy-safe init/process/recover events + stage formatting |
| `src/lib/batch/buildAutoMaskQueue.ts` | Pending excludes in-flight; `countInFlightMasks` |
| `src/App.tsx` | Reset queue to `pending` after model ready; pass `runningCount` |
| `src/components/BatchPanel.tsx` | Show **running** count; iPhone keep-tab-open hint |
| Tests | Diagnostics, pending/in-flight counts, worker recover after timeout |

**Not changed:** model id, thresholds, fallbacks, desktop queue contract (still serial, no silent success on failure).

---

## 6. Tests / commands

| Command | Result |
| --- | --- |
| Focused vitest (sdk + diagnostics + queue + App + BatchPanel) | **0** — 32 tests / 5 files |
| `npm run typecheck` | **0** |
| `npm test` | **0** — **318** tests / **49** files |
| `npm run build` | **0** |

**Physical iPhone 15 Safari test:** **NOT PERFORMED** in this environment.

---

## 7. Remaining risks & client retest

1. Retest on **physical iPhone 15 Safari** with 8 JPEGs, Wi‑Fi, tab foreground.  
2. Expect: progress may show **running 1 / pending 7** (not 8 pending) while image 1 inferencing; stage text **Running on-device inference…** (with elapsed seconds).  
3. Cold first run may still take a long time (download + WASM). Wait through timeouts (**180s** init / **120s** per image) before declaring stuck.  
4. If one image times out, it should become **failed**, worker recover, batch continue; use **Retry failed**.  
5. Capture: iOS version, Safari version, whether progress % appeared during download, backend (`wasm`/`webgpu`), wall time to first mask or fail.

---

## 8. Claim boundaries

| Claim | Status |
| --- | --- |
| Issue fully root-caused on client device | **No** |
| Relevant fixes verified in automated tests | **Yes** (timeout recover, counters, diagnostics) |
| Fixes verified on physical iPhone 15 Safari | **No** |
| Model still RMBG-1.4 | **Yes** |
