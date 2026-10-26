# iPhone 15 Safari auto-mask — diagnostic report

**Date:** 2026-10-26 (same-origin RMBG-1.4 q8 mirror pass)  
**Client screenshot:** Safari iOS · `garment-background-studio.vercel.app`  
**Error on device:**
```text
Auto-mask failed: Load failed
Use Batch → Retry selected / Retry failed.
```
Batch: **2 images · 0 masked · 2 failed**

**Model:** unchanged family — `bg-remove-sdk` + BRIA `briaai/RMBG-1.4` (**q8** ONNX)  
**Physical validation after this fix:** **NOT PERFORMED** on a tethered device in this agent session.

---

## Root cause (this screenshot)

| Item | Finding |
| --- | --- |
| Symptom | Bare `Load failed` persisted after CSP allowlists + Cache API clear/retry |
| Mechanism | Worker still fetched weights from `huggingface.co` → redirect `us.aws.cdn.hf.co`; Safari WebKit continues to fail that path opaquely |
| Why UI showed bare text | Device session likely still failing at download before/without applying the long formatter path, or stale tab; production already contained the longer copy |
| Durable fix needed | Stop depending on HF CDN from the phone: **same-origin** static mirror |

---

## Fix

| Change | Detail |
| --- | --- |
| `scripts/fetchRmbgBrowserWeights.mts` | Mirror `config.json`, `preprocessor_config.json`, `onnx/model_quantized.onnx` (~44 MB) into `public/models/briaai/RMBG-1.4/` at build |
| `scripts/emitBgRemoveWorker.mts` | Patch SDK worker: `allowLocalModels=true`, `allowRemoteModels=false`, `localModelPath="/models/"` → `public/bg-remove-worker.js` |
| `bgRemoveSdk.ts` | Pass `workerUrl` + force **q8** when same-origin weights are enabled |
| Batch copy | “~44 MB” from this site (not HF CDN) |
| Prior CSP / cache-clear | Kept as defense in depth |

---

## Tests / build / deploy

| Check | Result |
| --- | --- |
| Unit | 342 passed (worker patch contract, q8/workerUrl options, Load failed cache retry) |
| Build | Emits worker + mirrors weights into `dist/models/…` |
| Production deploy | **Live** — `dpl_4i9BEShXDr2wP7fRPinuDhDpaGRV` |
| Live HEAD `/models/…/model_quantized.onnx` | **200** · `Content-Length: 44403226` |
| Live HEAD `/bg-remove-worker.js` | **200** · patched worker |

---

## Claim status

| Claim | Status |
| --- | --- |
| Safari no longer needs HF CDN for RMBG-1.4 q8 | **Yes** (same-origin `/models/…`) |
| Model family still RMBG-1.4 | **Yes** (quantized artifact of same repo) |
| iPhone 15 Safari auto-mask proven | **Not claimed** — hard-refresh, confirm Batch hint says “~44 MB” / “from this site”, then Auto-mask / Retry failed |
