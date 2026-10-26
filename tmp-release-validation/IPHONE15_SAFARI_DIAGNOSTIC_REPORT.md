# iPhone 15 Safari auto-mask — diagnostic report

**Date:** 2026-10-26 (HF CDN `Load failed` / connect-src pass)  
**Client screenshot:** Safari iOS · `garment-background-studio.vercel.app`  
**Error on device:**
```text
Auto-mask failed: Load failed
Use Batch → Retry selected / Retry failed.
```
Batch badges: **2 images · 0 masked · 2 failed**

**Model:** unchanged — `bg-remove-sdk` + BRIA `briaai/RMBG-1.4`  
**Physical validation after this CSP fix:** **NOT PERFORMED** on a tethered device in this agent session (screenshot is client evidence of the pre-fix failure mode).

---

## Root cause (this screenshot)

| Item | Finding |
| --- | --- |
| Stage | Model **weight download** during init (not WASM compile, not inference) |
| Mechanism | Hugging Face `resolve/` redirects weights to multi-label CDN hosts such as `https://us.aws.cdn.hf.co/...` |
| Why Safari fails | Document CSP had `connect-src … https://*.hf.co` but Safari treats `*.hf.co` as **one DNS label only**, so `us.aws.cdn.hf.co` was blocked → WebKit surfaces opaque **`TypeError: Load failed`** |
| Relation to prior bugs | Distinct from WebGPU module-import, WASM OOM (`RangeError`), and ORT `.mjs` `script-src` failures |

---

## Fix

| Change | Detail |
| --- | --- |
| `connect-src` | Add `https://*.cdn.hf.co`, `https://*.aws.cdn.hf.co`, `https://*.xethub.hf.co` |
| `vercel.json` + `contentSecurityPolicy.ts` | Kept in sync; assert helpers require `cdn.hf.co` + `aws.cdn.hf.co` |
| Error copy | `formatBgRemoveInitFailureMessage` maps bare `Load failed` to weight-download / HF CDN guidance |
| Diagnostics | `classifyBgRemoveFailure('Load failed')` → `download` |
| Prior mobile prefs | Still prefer WASM + q8 on Apple mobile; still single shared session; no eager preload on Apple mobile |

---

## Tests / build / deploy

| Check | Result |
| --- | --- |
| CSP unit tests | Expect `cdn.hf.co` + `aws.cdn.hf.co` in connect-src; vercel.json matches builder |
| Device classifiers | Safari Load failed → download guidance |
| Diagnostics | Load failed → `download` stage |
| typecheck / test / build | **Pass** (340 tests) |
| Production deploy | **Live** — `dpl_H2dKLL4d5G2Wzs3Zpm6cYqHuxR6N` → https://garment-background-studio.vercel.app |
| Live CSP curl | `connect-src` includes `https://*.cdn.hf.co` + `https://*.aws.cdn.hf.co` + `https://*.xethub.hf.co` |
| HF redirect probe | `huggingface.co/.../model_quantized.onnx` → `302` → `https://us.aws.cdn.hf.co/...` |

---

## Claim status

| Claim | Status |
| --- | --- |
| Screenshot “Load failed” explained by CSP blocking HF CDN redirect | **Yes** |
| CSP updated to allow `*.cdn.hf.co` / `*.aws.cdn.hf.co` | **Yes** |
| Clearer operator message for bare Load failed | **Yes** |
| iPhone 15 Safari auto-mask proven after deploy | **Not claimed** — hard-refresh production, then Batch → Retry failed on device |
