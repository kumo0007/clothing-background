# Final release-readiness audit — Garment Background Studio

**Date:** 2026-10-26  
**Verdict:** **NOT production-ready for commercial catalog deployment**  
**Limited supervised / non-commercial technical delivery:** **CONDITIONAL GO** (accept blockers below)

This report uses **fresh** typecheck, lint, tests, build, Node audits, and browser probes from this session. Prior “28.5s / 276 tests” claims were re-verified or superseded with new measurements.

---

## 1. Verified CI / Node gates (this session)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (pre-existing warnings only; no errors) |
| `npm test` | **278 passed** / 42 files |
| `npm run build` | Pass |
| `npx tsx scripts/auditMaskDiagnostics.mts` | Pass (Lab-seed **proxy** — not live RMBG) |
| `npx tsx scripts/validateSlipDressRelease.mts` | Pass (Lab-seed proxy + peel integrity) |
| `npx tsx scripts/auditLocalAutoMask.mts` | Pass (0 fetch calls; Lab-seed) |

### Lab-seed proxy clothing flags (do **not** cite as RMBG quality)

| Fixture | neural review (on Lab silhouette) | Top rule |
| --- | --- | --- |
| `03_tshirt.jpg` | true | `border_studio_leak` |
| `08_sneakers.jpg` | true | `fragmented_keep` |
| Others in 01–10 set | mostly false | `internal_holes` info on some |

---

## 2. Verified browser results (Chromium + mobile-style / high-res probes)

Environment: Cursor IDE browser → `http://127.0.0.1:4173/` (Vite preview of production build). **Not a physical phone.**

### Cold model cache (caches cleared)

| Metric | Value |
| --- | --- |
| Caches cleared | 1 |
| Progress UI | `Loading model…` → `Downloading onnx/model_fp16.onnx… (0→100%)` |
| Model ready | ~**155 s** after Auto-mask click |
| 10 clothing fixtures finish | ~**188 s** total wall clock → **`10 masked`**, 0 failed |
| Upload auto-starts inference? | **No** (`10 pending` / CTA shown) |

### Warm cache

| Metric | Value |
| --- | --- |
| 2 fixtures (`03_tshirt`, `08_sneakers`) | ~**7.1 s** → `2 masked` |
| “Loading model” download progress | Not observed (weights cached) |

### High-resolution / orientation

| Case | Result |
| --- | --- |
| Synthetic **4032×3024** JPEG | Masked; preview meta **`4032 × 3024px`** (export dims preserved after downscale→remap) |
| Review on that synthetic | Flagged for review (pale studio + solid mass) — diagnostics still fire |
| Portrait **1080×1920** + slip dress mix | Both masked; portrait meta **`1080 × 1920px`** |

### Live RMBG on fixture set `01`–`10` (cold run)

| Result | Value |
| --- | --- |
| Masked | **10 / 10** |
| Failed | 0 |
| Review badges | **0** on these small fixtures |

**Interpretation:** Live RMBG succeeded technically. **0 Review on white tee / sneakers fixtures does not prove production visual quality** — Lab-seed still flags those shapes; operator visual QC remains mandatory for pale garments, straps, handbags, and border leak. Thresholds were **not** loosened.

### HEIC / formats

| Check | Result |
| --- | --- |
| Uploader copy mentions HEIC + JPEG conversion | Yes |
| Batch hint mentions HEIC before Auto-mask | Yes (updated this session) |
| HEIC rejection message (unit) | Pass |
| HEIC decode support | **Unsupported** (accepted limitation) |

### Manual-edit / failure integrity (unit + code)

| Check | Result |
| --- | --- |
| `buildAutoMaskQueue` skips successful + `hasManualEdits` | Pass |
| Failed images do not set `hasEdits` → not counted masked | Pass |
| Model init failure marks queue failed | Pass (unit) |
| Partial batch continues | Pass (unit) |
| Mask remap after downscale preserves source dims | Pass (new unit tests) |
| **Bug fixed:** diagnostics panel was passed `hasEdits` as `hasManualEdits` | Fixed → uses `hasManualEdits` flag |

---

## 3. Emulation-only / not verified on device

| Item | Status |
| --- | --- |
| Physical iPhone Safari | **Not tested** |
| Physical Android Chrome | **Not tested** |
| Real multi‑MP camera HEIC→JPEG conversion UX | **Not tested on device** |
| Tab suspension mid-batch on mobile OS | **Not tested** |
| Sustained OOM on 8×12MP photos on mid-tier phones | **Not tested** (desktop high-res synthetic only) |
| Prior claim “8 images ~28.5s warm” | Replaced by this session’s warm/cold numbers above |

---

## 4. Licensing (verified terms — **commercial release blocker**)

| Component | Terms verified |
| --- | --- |
| `bg-remove-sdk` | **MIT** (`node_modules/bg-remove-sdk/LICENSE`) |
| Model `briaai/RMBG-1.4` | HF card: license name **`bria-rmbg-1.4`**, described as source-available for **non-commercial** use; commercial use requires a **BRIA commercial agreement** ([model card](https://huggingface.co/briaai/RMBG-1.4), [license agreement](https://bria.ai/bria-huggingface-model-license-agreement/), commercial CTA e.g. [go.bria.ai](https://go.bria.ai/3B4Asxv)). Non-commercial evaluation agreement restricts evaluation use and prohibits hosting/distribution for others. |

**Local / in-browser inference does not eliminate these restrictions.**  
Documented in `README.md` (updated this session).

---

## 5. Unresolved defects / accepted risks

| ID | Severity | Item | Disposition |
| --- | --- | --- | --- |
| L1 | **Blocker (commercial)** | No BRIA commercial license on file | Must obtain license or replace model |
| L2 | High (ops) | First-run ~88 MB download (~2.5+ min observed here) | Accepted with progress UI + timeout; self-host/`modelId` recommended |
| L3 | Medium | HEIC unsupported | Accepted; copy + error message clear |
| L4 | Medium | No physical-device sign-off | Required before claiming “mobile production ready” |
| L5 | Medium | Live RMBG may under-flag pale tee/sneaker fixtures vs Lab-seed | Keep supervised QC; **do not** lower thresholds without new false-negative evidence |
| L6 | Low | Soft halos / straps / handbag openings | Visual QC; peel/diagnostics available |
| L7 | Low | `@imgly/*` still in tree (AGPL) for legacy paths | Not Batch default; legal review if those paths ship |

---

## 6. Production-ready decision

| Use case | Decision |
| --- | --- |
| Commercial product catalog (paid SKUs, customer delivery) | **NO** — until **L1** resolved |
| Internal / non-commercial supervised evaluation | **CONDITIONAL YES** — accept L2–L6; require Review pass on pale/strap/handbag SKUs |
| “Mobile production ready” marketing claim | **NO** — until physical device matrix (L4) |

---

## 7. Changes made during this audit (bugs / clarity only)

1. **`App.tsx`:** pass `hasManualEdits={!!maskMeta.hasManualEdits}` into diagnostics (was incorrectly using `hasEdits`).
2. **`BatchPanel` + README:** HEIC / BRIA license wording clarified.
3. **Unit tests:** phone-resolution mask remap + portrait remap; HEIC batch hint assertion.
4. **No segmentation threshold changes.**

---

## 8. Evidence artifacts

- `tmp-mask-diagnostics-audit/report.json`
- `tmp-release-validation/slip-dress-node-report.json`
- `tmp-local-automask-audit/`
- `tmp-release-validation/FINAL_RELEASE_READINESS_AUDIT.md` (this file)
- Browser cold/warm/high-res timelines captured in this audit session
