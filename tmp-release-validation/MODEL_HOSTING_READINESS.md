# Model hosting readiness — RMBG-1.4 (fp16 ONNX)

**Date:** 2026-10-26  
**Production model:** unchanged — `bg-remove-sdk` + `briaai/RMBG-1.4` (`dtype: 'fp16'`).  
**Implementation status this phase:** **Documentation only.** Do **not** move weights to a new host until the BRIA commercial agreement is resolved (`BRIA_COMMERCIAL_LICENSE_CHECKLIST.md`).

---

## 1. Current weight-loading flow

```
Upload (optional background preload)
  → getSharedBgRemover()
      createBgRemover({
        device: 'auto',
        dtype: 'fp16',
        useBrowserCache: true,
        modelId?: from VITE_BG_REMOVE_MODEL_ID
      })
  → remover.preload()  [timeout BG_REMOVE_PRELOAD_TIMEOUT_MS = 180s]
      Web Worker + @huggingface/transformers
      Fetch HF layout: config + preprocessor + onnx/model_fp16.onnx (~88.2 MB)
      Store in browser Cache API (per origin)
  → Auto-mask all / per image
      remover.process()  [timeout BG_REMOVE_PROCESS_TIMEOUT_MS = 120s]
      Transparent PNG alpha → MaskPixelBuffer (original RGB untouched)
```

| Aspect | Current behavior |
| --- | --- |
| Default remote source | Hugging Face CDN for `briaai/RMBG-1.4` |
| Override | `VITE_BG_REMOVE_MODEL_ID` — HF-compatible id or mirror path that still identifies **RMBG-1.4** (`resolveBgRemoveModelId` allowlist; other families ignored) |
| Caching | `useBrowserCache: true` → Cache API; warm loads skip full download |
| Integrity | Relies on transformers.js / HF fetch; **no separate app-level SHA pin** today |
| MIME / format | ONNX via transformers.js pipeline; SDK expects RMBG-style preprocess |
| Timeouts | Preload 180s; process 120s — failures surface; not treated as ready |
| Failure recovery | Clear `preloadPromise` on failure; Retry failed / re-tap Auto-mask; progress messages |
| Secrets | None required for HF public gated form flow; **do not** put tokens in client env for public apps |
| Concurrency | One shared `BgRemover`; serial inference (mobile memory) |

Code: `src/lib/mask/bgRemoveSdk.ts`, package `bg-remove-sdk@0.1.0`.

---

## 2. Measured cold / warm behavior (existing evidence)

| Condition | Measurement | Source |
| --- | --- | --- |
| Cold (caches cleared, Chromium preview) | Download `model_fp16.onnx` ~0→100% over ~**140+ s**; ready ~**155 s**; 10 fixtures ~**188 s** wall | `FINAL_RELEASE_READINESS_AUDIT.md` |
| Warm (2 fixtures, tee/sneaker) | Init→ready ~**6.7 s**; process sum ~**7.7 s**; last process ~**3.5 s** | `tee-sneaker-live-rmbg.json` / blocker investigation |
| Warm (4 fixtures @ 390×844 emulation) | ~**10 s** wall; **4/4** masked | `PRODUCTION_AUDIT_BROWSER_EVIDENCE.json` |
| Weight size | ~**88 MB** fp16 (HF lists **88.2 MB** for `onnx/model_fp16.onnx`) | HF onnx tree + SDK README |

**Root cause of cold latency:** network download of ~88 MB, not per-image math.

---

## 3. Expected benefits and risks of self-hosting

### Benefits

- Lower / more predictable cold-start vs public HF CDN (especially mobile / Asia / corporate networks).
- Control over CORS, caching headers, and uptime SLAs.
- Ability to pin a known ONNX byte revision for ops.

### Risks

- **Licensing:** mirroring/redistributing BRIA weights without a commercial grant may violate `bria-rmbg-1.4` non-commercial terms — **blocker until agreement clarifies self-host rights**.
- Stale mirror if HF updates weights and you do not re-sync.
- Bandwidth / egress cost on first-hit storms.
- Incorrect HF layout (missing `preprocessor_config.json`) → init failures.
- Putting HF tokens or private URLs with secrets in `VITE_*` would expose them to clients — **forbidden**.

---

## 4. Integrity and caching requirements (recommended when legal)

| Requirement | Recommendation |
| --- | --- |
| Files to mirror | Same HF layout: `config.json`, `preprocessor_config.json`, `onnx/model_fp16.onnx` (and any sidecar transformers.js expects) |
| Integrity | Record SHA-256 of `model_fp16.onnx` at mirror time; optional CI check before deploy |
| HTTP cache | Long `Cache-Control` / immutable for content-hashed paths; support Range if CDN allows |
| Browser Cache API | Keep `useBrowserCache: true` so second visit is warm |
| Clear path | Document `clearModelCache('briaai/RMBG-1.4')` for forced refresh after weight updates |
| Version pin | Freeze commit / file revision of HF repo used for the mirror |

---

## 5. Hosting and bandwidth considerations

| Topic | Note |
| --- | --- |
| First load per user/origin | ~88 MB once (then Cache API) |
| Concurrent new users | CDN must absorb N × 88 MB |
| Mobile cellular | Prefer Wi‑Fi messaging already in UI; 180s timeout |
| New paid infra | Not required for readiness docs; if using a paid CDN, document cost separately — **do not add** in this phase without owner approval |
| App change already present | `VITE_BG_REMOVE_MODEL_ID` — no model algorithm change |

---

## 6. Licensing prerequisites (gate)

Self-hosting the **exact** RMBG-1.4 fp16 ONNX is an ops improvement **only if** BRIA’s commercial agreement (or written permission) allows:

- Hosting/mirroring weights on your origin/CDN, and  
- End-user download into browser cache for inference.

Until `BRIA_COMMERCIAL_LICENSE_CHECKLIST.md` is **RESOLVED** with those rights:

- **Do not** vendor weights into `public/`.  
- **Do not** point production at a new mirror for commercial traffic.  
- Evaluation/non-commercial use remains subject to BRIA non-commercial terms even on a mirror.

---

## 7. Recommended implementation plan (preserve production model)

Ordered steps — **stop before step 3 until licensing is clear**:

1. **Complete BRIA commercial checklist** (self-host + browser cache clauses).  
2. **Pin** HF revision / SHA-256 of `onnx/model_fp16.onnx`.  
3. **Mirror** HF-compatible tree to CDN or private HF-compatible endpoint (no secrets in client).  
4. Set **`VITE_BG_REMOVE_MODEL_ID`** to that mirror id/path in production env (build-time).  
5. Keep `dtype: 'fp16'`, `device: 'auto'`, `useBrowserCache: true`, same `BG_REMOVE_*_TIMEOUT_MS`.  
6. **Smoke:** cold clear Cache API → download from mirror → warm reload → 8-image batch; compare method id still `bg-remove-sdk-rmbg1.4`.  
7. Update readiness report with mirror URL (non-secret) and measured cold times.  
8. **Do not** change segmentation thresholds or swap models.

### Explicitly out of scope / rejected here

- Switching to U²-Netp / BiRefNet / Lab-seed.  
- Quantized ONNX as silent default (quality change).  
- Parallel multi-worker inference on mobile.  
- Embedding HF access tokens in the SPA.

---

## 8. Code changes this phase

**None.** Existing preload, timeouts, progress copy, and `VITE_BG_REMOVE_MODEL_ID` already cover the safe technical hooks. No verified defect required a hosting code change without crossing the licensing gate.
