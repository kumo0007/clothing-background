# BiRefNet WebGPU GatherND rewrite — production-readiness review

**Date:** 2026-10-28  
**Branch:** `experiment/birefnet-webgpu-graph-rewrite`  
**Scope:** Experimental rewrite only — **not enabled by default; production path unchanged**  
**Prior experiment report:** `tmp-model-eval/BIREFNET_WEBGPU_GATHERND_REWRITE_REPORT.md`  
**Artifacts:** `tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/production-readiness/`

---

## Executive verdict

**NOT APPROVED to ship / enable by default.**

The rewrite remains a **viable candidate** with strong evidence on typical product shots and reproducible ~2× warm speedup on Chrome WebGPU, but this review found **blocking product/policy gaps** before enablement:

1. **Hard-case GPU disagreement** on `polo-6` (carpet hem): WebGPU↔WASM IoU **0.874** (bg leakage proxy **2.14%**) while other fixtures stay ≥0.997.
2. **No GPU golden policy** — production SHA fixtures are WASM-locked; WebGPU is not bit-identical.
3. **Browser coverage incomplete** — Firefox has no usable WebGPU here; WebKit Playwright browser not installed on this host.
4. **Device-loss** not hardware-fault-injected (covered by unit tests for degenerate logits + WASM-only fallback path only).
5. Requires explicit product approval for a second ONNX artifact + EP selection UX.

Production checkpoint, `session.ts` default URL, and default EP preference (**WASM unless `VITE_BIREFNET_WEBGPU=1`**) were **not changed**.

---

## Production-readiness checklist

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Graph rewrite audit (bounds, flatten, shapes, batch, numerics) | **PASS** | `audit-rewrite.json` — synthetic GatherND≡linearize exact; batch `[1,1]` assumed; OOB inherits GatherND (documented risk) |
| 2 | Expanded hard-case quality (white/light, sneakers, carpet, handles, low-contrast) | **CONDITIONAL** | 9/10 fixtures IoU≥0.997; **polo-6 IoU 0.874** (known hard carpet hem) |
| 3 | No invalid/empty masks on rewrite WebGPU | **PASS** | All hard cases `degenerate=false`, KEEP>0 |
| 4 | No unacceptable garment-removal regressions (typical shots) | **PASS** | False removal ≤0.07% on non-polo-6; polo-6 flagged |
| 5 | Repeated inference stable + bounded memory | **PASS*** | 8× same image: fingerprint stable, keepSpan=0; warm median **5683 ms**; JS heap growth **+36.8 MB** (watch); peak ~103 MB |
| 6 | Reproducible performance vs WASM ~11.2 s | **PASS** | Lifecycle warm ~5.7 s; batch5 ~28.6 s (matches prior ~5.3 s / ~29 s) |
| 7 | Browser/device WebGPU matrix documented | **PASS** | Chrome/Edge WebGPU **yes**; Firefox **no gpu**; WebKit engine **not installed** |
| 8 | WebGPU unavailable → graceful, no corrupt masks | **PASS** | WASM-only mode KEEP valid; unit tests: degenerate WebGPU→WASM rebuild; double-degenerate throws |
| 9 | Experimental ONNX isolated; cannot enable accidentally | **PASS** | Guard `experiment:birefnet-webgpu-guard`; rewrite only under `tmp-model-eval/`; prod scans clean |
| 10 | Dependencies / licensing / deploy constraints reviewed | **PASS*** | No new npm runtime deps; DIS5K commercial note remains; dual-artifact deploy cost |
| 11 | typecheck / tests / lint / build / weights / goldens / guard | **PASS** | See gate table below |
| 12 | Production path / default model unchanged | **PASS** | Stock SHA `eff9216…` / 98 484 532; constants + session URL unchanged |
| 13 | Ready to enable in production by default | **FAIL** | Blocked by polo-6 policy gap, GPU golden policy, incomplete browser matrix, explicit approval required |

\*Pass with residual risks listed below.

---

## 1. Graph rewrite audit

Script: `experiments/birefnet-webgpu-rewrite/audit_rewrite_semantics.py` → `audit-rewrite.json`

| Check | Result |
| --- | --- |
| Index order | `indices[...,0]=y`, `indices[...,1]=x`; `lin=y*W+x` row-major |
| Output shape | Gather indices squeezed to `[N]` → `[1,1,N,C]` matches GatherND |
| Numeric identity (in-bounds synthetic) | maxAbsDiff **0** for (18²×256), (66²×4096), (134²×1000), boundary corners |
| Batch behavior | Hard-requires leading dims **1,1** (matches BiRefNet single-image) |
| OOB indices | **No Clamp added** — same undefined EP behavior as stock GatherND |
| ScatterND | 72 untouched |

**Residual risk:** Out-of-range deformable indices are not newly hardened; acceptable only because rewrite preserves stock semantics.

---

## 2. Expanded quality metrics

Source: `production-readiness/browser-readiness.json` → `hardCaseQuality`

| Case | Tags | WASM KEEP | WebGPU KEEP | IoU | False rem.% | BG leak.% |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| white-tshirt | white / light / low-contrast | 0.4901 | 0.4902 | 0.9992 | 0.013 | 0.025 |
| white-sneakers | sneakers / fine edge | 0.3450 | 0.3451 | 0.9989 | 0.015 | 0.024 |
| open-handbag | thin handles | 0.3565 | 0.3564 | 0.9984 | 0.031 | 0.028 |
| slip-dress | low-contrast drape | 0.2449 | 0.2453 | 0.9979 | 0.005 | 0.045 |
| polo-1 | carpet | 0.4003 | 0.4002 | 0.9990 | 0.028 | 0.013 |
| polo-5 closeup | carpet / closeup | 0.7387 | 0.7381 | 0.9990 | 0.068 | 0.008 |
| **polo-6 hem** | **carpet / hard** | **0.1549** | **0.1755** | **0.8743** | **0.075** | **2.142** |
| polo-8 tape | carpet / hard | 0.1721 | 0.1719 | 0.9960 | 0.042 | 0.026 |
| dark-hoodie | baseline | 0.5543 | 0.5543 | 0.9990 | 0.030 | 0.023 |
| coat | outerwear | 0.3925 | 0.3923 | 0.9992 | 0.027 | 0.006 |

### Representative failure / hard cases

- **polo-6 (hem on carpet):** Both EPs already low KEEP (~15–18%). WebGPU keeps **more** background (leak 2.14%) vs WASM — largest cross-EP disagreement. Prior clothing sweep already marked similar polo shots as manual-required. **Treat as known hard case, not a silent KEEP=0 bug.**
- **polo-8 / low KEEP carpet:** Cross-EP IoU still high (0.996); absolute quality remains difficult.
- **White-on-light / handles / slip-dress:** No unacceptable regression vs WASM rewrite.

WASM stock↔rewrite remains **bit-exact** on prior golden+clothing eval (`clothing-eval.json`).

---

## 3. Regression & resource-lifecycle results

Source: `lifecycle` in `browser-readiness.json` (Chrome, rewrite WebGPU, hoodie ×8 + 5-image batch)

| Metric | Value | Pass? |
| --- | --- | --- |
| Cold init | 11 180 ms | — |
| Warm median (8×) | **5 683 ms** | Yes vs ~11.2 s WASM baseline |
| keepSpan across repeats | **0** | Yes |
| Logit fingerprint stable | **true** | Yes |
| 5-img batch total | 28 584 ms | Yes (~29 s prior) |
| Invalid masks | none | Yes |
| Peak JS heap | ~103 MB | Bounded |
| JS heap growth (iter0→8) | **+36.8 MB** | Watch — coarse; GPU VRAM not visible |

No browser crash. No `computeSliceOffsets` Tint errors observed on rewrite WebGPU.

**Not tested:** true `GPUDevice.lost` injection mid-session (browser limitation in this harness). Closest coverage: production unit tests for degenerate logits → WASM rebuild.

---

## 4. Device / browser matrix

| Browser | Launch | `navigator.gpu` | Rewrite WebGPU usable on this host | Notes |
| --- | --- | --- | --- | --- |
| Chrome (channel) | Yes | Yes | **Yes** (quality + lifecycle) | Primary target |
| Edge (channel) | Yes | Yes | **Likely yes** (probe only) | Same Chromium WebGPU stack |
| Firefox (Playwright) | Yes | **No** | **Unsupported** | Must use WASM |
| WebKit | **No** (Playwright browser not installed) | — | **Unknown / unsupported for now** | Install `npx playwright install webkit` for follow-up |

**Unsupported configurations (documented):** Firefox WebGPU EP; environments without `navigator.gpu`; WebGL path (stock FP16 still unsupported — unchanged).

---

## 5. WebGPU init failure / device-loss behavior

| Scenario | Behavior | Test |
| --- | --- | --- |
| WebGPU disabled / unavailable → WASM-only | Valid KEEP mask; no invented empty mask | `mode=unavailable` harness (`ok: true`, KEEP 0.4901 on tshirt) |
| WebGPU session emits all-negative logits | Rebuild WASM; return non-degenerate logits | `birefNet.test.ts` — **PASS** |
| WASM retry also degenerate | **Throw** (no silent corrupt mask) | `birefNet.test.ts` — **PASS** |
| Default production prefer WebGPU | **Off** unless `VITE_BIREFNET_WEBGPU=1` | Guard asserts gate still present |
| Rewrite ONNX accidentally selected | **Blocked** — not referenced from `session.ts` / App / constants | Guard — **PASS** |

Production still loads **stock** ONNX. Enabling WebGPU with stock weights still risks KEEP=0 (pre-rewrite); opt-in flag alone must not flip to rewrite without a separate change.

---

## 6. Isolation confirmation

```text
npm run experiment:birefnet-webgpu-guard → ok
stock sha = eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516
bytes    = 98484532
rewrite  = tmp-model-eval/.../model_fp16.gathernd_rewrite.onnx only
```

No `gathernd_rewrite` under `public/models/.../onnx/`.

---

## 7. Licensing & deployment

Source: `licensing-audit.json`

| Item | Status |
| --- | --- |
| New npm runtime dependencies for rewrite | **None** |
| `onnxruntime-web@1.21.0` | MIT (already production) |
| BiRefNet lite weights | MIT; **DIS5K training-data commercial review still required** |
| Rewritten ONNX | Topology-only; same MIT weights; must be separately hashed if shipped |
| Deploy cost | +~98.5 MB if dual-hosted; or replace stock only after SHA + golden policy update |
| ORT upstream | #32733 still draft — may obsolete rewrite later |

---

## 8. Gate results (this review)

| Gate | Result |
| --- | --- |
| `npm run typecheck` | **PASS** |
| `npm test` | **PASS** (405 passed, 2 skipped) |
| `npm run lint` | **PASS** (pre-existing warnings only; exit 0) |
| `npm run build` | **PASS** |
| `npm run validate:birefnet-weights` | **PASS** |
| `npm run assert:birefnet-fixtures` | **PASS** (5/5 KEEP% + SHA) |
| `npm run experiment:birefnet-webgpu-guard` | **PASS** |
| Static rewrite audit | **PASS** |
| Browser readiness harness | Completed (quality conditional fail on polo-6 threshold) |

---

## Remaining risks (ordered)

1. **polo-6-class carpet/hem disagreement** under WebGPU vs WASM (IoU 0.874) — needs product tolerance or exclude-from-auto.
2. **GPU masks ≠ WASM golden SHA** — need separate acceptance band (e.g. IoU≥0.99 on product set) before EP switch.
3. **JS heap +36 MB** over 8 repeats in harness — re-measure with `session.release` / image bitmap lifecycle; add GPU memory telemetry.
4. **Firefox / Safari** not WebGPU-ready for this path — WASM fallback mandatory.
5. **ScatterND/Sum** untouched — possible CPU fallback / memory pressure on weaker GPUs.
6. **True device-loss** mid-inference untested.
7. **DIS5K** commercial licensing (pre-existing).

---

## Recommendation

**Do not enable** the experimental rewrite or WebGPU-by-default until:

1. Product signs off on polo-6 / low-KEEP carpet handling,  
2. A WebGPU acceptance policy replaces bit-exact golden SHAs for GPU,  
3. Edge + at least one more real GPU host re-bench,  
4. Packaging plan for the second ONNX (or ORT upgrade that fixes GatherND).

Until then: keep rewrite under `experiments/` + `tmp-model-eval/`, production on **stock WASM**.

### Exact experiment files added/updated this review

- `experiments/birefnet-webgpu-rewrite/audit_rewrite_semantics.py`
- `experiments/birefnet-webgpu-rewrite/review_browser_readiness.mts`
- `experiments/birefnet-webgpu-rewrite/licensing_audit.mts`
- `experiments/birefnet-webgpu-rewrite/assert_prod_model_untouched.mts` (strengthened)
- `src/lib/mask/birefNet/birefNet.test.ts` (WebGPU degenerate fallback tests)
- `package.json` script `experiment:birefnet-webgpu-readiness`
- `tmp-model-eval/BIREFNET_WEBGPU_REWRITE_PRODUCTION_READINESS.md` (this file)
- `tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/production-readiness/*`
