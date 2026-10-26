# iPhone 15 Safari auto-mask — diagnostic report

**Date:** 2026-10-26  
**Client:** Safari on iPhone 15  
**Observed:** 8 uploaded · 0 masked · 8 failed  

**Exact error:**
```text
Auto-mask stopped: Model init failed (no available backend found. ERR: [webgpu]
TypeError: Importing a module script failed.).
```

**Production model:** unchanged — `bg-remove-sdk` + BRIA RMBG-1.4 (`fp16`).  
**Production deploy (this fix):** `dpl_2BHxjuvPLmx7dST3SGzUGm39sGEY` → https://garment-background-studio.vercel.app/  
**Physical iPhone 15 validation:** **NOT PERFORMED** (no device attached to this agent).

---

## 1. Root cause (code + SDK evidence)

| Step | What happens |
| --- | --- |
| App | `createBgRemover({ device: 'auto', dtype: 'fp16' })` (previously) |
| SDK worker `s1('auto')` | If `navigator.gpu.requestAdapter()` returns an adapter → **force `device: 'webgpu'`**, else WASM |
| iOS Safari 17+/18 | Often exposes `navigator.gpu` + adapter even when ORT WebGPU cannot load |
| ORT init | WebGPU path dynamically imports its JSEP/module script inside the **blob** worker |
| Failure | `TypeError: Importing a module script failed` → ORT throws `no available backend found. ERR: [webgpu] …` |
| Fallthrough | With `device: 'webgpu'` selected, transformers/ORT does **not** then initialize WASM for that session |

So the failure is **backend runtime module import / selection**, not a missing RMBG-1.4 weight file and not a model switch. Production CSP allows `connect-src` to `cdn.jsdelivr.net` but **`script-src` is `'self' 'wasm-unsafe-eval'` only** — external ORT `.mjs` imports from a blob worker are fragile on WebKit; WASM via the SDK’s stubbed worker path is the supported on-device path for this app on iPhone.

**Not the cause (this incident):** silent model substitution, server-side inference, or batch accounting alone (init never became ready, so all 8 were correctly marked failed).

---

## 2. Fix (same model, supported backend)

| Change | Purpose |
| --- | --- |
| `src/lib/mask/bgRemoveDevice.ts` | Prefer **`device: 'wasm'`** on Apple mobile WebKit (iPhone/iPad Safari and iOS Chrome/Firefox shells) |
| `preloadBgRemoveModel` | If WebGPU-only backend init still fails, **one** recover + retry with **`device: 'wasm'`** (still RMBG-1.4) |
| Diagnostics | `backend_select` / `backend_fallback` events (no image bytes / secrets) |
| Errors | Clearer copy when WebGPU module import fails; Retry failed remains valid after `recoverSharedBgRemover` |

**Unchanged:** `bg-remove-sdk` package, RMBG-1.4 id, dtype `fp16`, timeouts, worker recovery, batch/manual/export flows, no silent alternate segmentation model.

---

## 3. Tests & build

| Command / suite | Result |
| --- | --- |
| `bgRemoveDevice.test.ts` | UA preference + WebGPU init failure classifier |
| `bgRemoveSdk.test.ts` | WASM retry after WebGPU backend error; iPhone UA creates remover with `device: 'wasm'` |
| `npm run typecheck` | **Pass** |
| `npm test` | **Pass** (335 tests) |
| `npm run build` | **Pass** (entry hash `index-VjtrEsHy.js` after this fix) |

---

## 4. Automated evidence vs physical device

| Check | Status |
| --- | --- |
| Code path: iPhone UA → WASM preference | Covered by unit tests |
| Code path: WebGPU init error → WASM retry | Covered by unit tests |
| Desktop Firefox production upload smoke | Separate CSP work; not a substitute for iPhone |
| **Physical iPhone 15 Safari · 8 images · Auto-mask all** | **NOT PERFORMED** |

### Physical validation checklist (when a device is available)

1. Open production URL in Safari (top-level tab).  
2. Upload the same 8 JPEGs.  
3. Batch → Auto-mask all; keep tab foreground on Wi‑Fi.  
4. Expect init progress mentioning WASM / local model; then 8 masked (or actionable per-image errors, not global WebGPU module failure).  
5. Confirm diagnostics (console `[bgRemove]` debug) show `backend_select` wasm or `backend_fallback` without image payloads.  
6. Record result in a follow-up note: **PASS / FAIL** with iOS version.

---

## 5. Claim status

| Claim | Status |
| --- | --- |
| Root cause identified in SDK auto→WebGPU + ORT module import | **Yes (code-level)** |
| Fix prefers/retries WASM for same RMBG-1.4 | **Yes (in repo)** |
| Client can process all 8 images on iPhone 15 Safari | **NOT VERIFIED on device** |
| Fix claimed as production-proven on iPhone | **No** |
