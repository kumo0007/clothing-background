# iPhone 15 Safari auto-mask — diagnostic report

**Date:** 2026-10-26 (WASM module-import / CSP pass)  
**Client screenshot:** Safari iOS · `garment-background-studio.vercel.app`  
**Error on device:**
```text
Model init failed (no available backend found. ERR: [wasm]
TypeError: Importing a module script failed.).
Check network access to download weights once, then retry.
```

**Model:** unchanged — `bg-remove-sdk` + BRIA `briaai/RMBG-1.4`  
**Physical validation after this CSP fix:** **NOT PERFORMED** on a tethered device in this agent session (screenshot is client evidence of the pre-fix failure mode).

---

## Root cause (this screenshot)

| Item | Finding |
| --- | --- |
| Stage | WASM **runtime module import** during ORT backend init (not weight download, not inference) |
| Mechanism | `bg-remove-sdk` / transformers.js loads `ort-wasm-simd-threaded.jsep.mjs` via dynamic `import()`, typically from `https://cdn.jsdelivr.net/npm/@huggingface/transformers@…/dist/` (and/or blob: URLs inside the worker) |
| Why Safari fails | Document CSP had `connect-src … https://cdn.jsdelivr.net` but **`script-src` only `'self' 'wasm-unsafe-eval'`**. Module `import()` is governed by **script-src**; Safari reports `TypeError: Importing a module script failed` |
| Relation to prior bugs | Distinct from WebGPU module-import and from `[wasm] RangeError: Out of memory` |

---

## Fix

| Change | Detail |
| --- | --- |
| `script-src` | Add `blob:` + `https://cdn.jsdelivr.net` (keep `'self'` + `'wasm-unsafe-eval'`; no `*`, no `unsafe-inline` / `unsafe-eval`) |
| `vercel.json` + `contentSecurityPolicy.ts` | Kept in sync; assert helpers require jsDelivr + blob in script-src |
| Error copy | Clearer message when WASM module import fails |
| Prior mobile prefs | Still prefer WASM + q8 on Apple mobile; still single shared session |

---

## Tests / build / deploy

| Check | Result |
| --- | --- |
| CSP unit tests | Expect jsDelivr + blob in script-src |
| Device classifiers | WASM module-import detection |
| typecheck / test / build | **Pass** (339 tests) |
| Production deploy | **Live** — `script-src` includes `blob:` + `https://cdn.jsdelivr.net` (verified via curl) |

---

## Claim status

| Claim | Status |
| --- | --- |
| Screenshot error explained by CSP blocking ORT `.mjs` | **Yes** |
| CSP updated to allow that import | **Yes** |
| iPhone 15 Safari 8/8 auto-mask proven after deploy | **Not claimed** — retest on device after hard-refresh |
