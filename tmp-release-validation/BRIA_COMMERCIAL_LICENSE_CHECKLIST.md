# BRIA RMBG-1.4 — commercial license checklist

**Date:** 2026-10-26  
**Status:** **UNRESOLVED** — no executed BRIA commercial agreement is on file in this repository.  
**Evidence artifact:**  
**Owner attestation:**  
**Rule:** Do not mark this gate passed without verifiable written evidence. Do not fabricate agreements or contact BRIA as the product owner from this agent session.

### Automated gate limitations (read carefully)

| Fact | Meaning |
| --- | --- |
| `npm run verify:release` | Technical checks only; prints license status; **does not** approve commercial use |
| `npm run verify:commercial-release` | Fails while Status is UNRESOLVED / incomplete / missing / attestation or evidence path absent |
| Status → **RESOLVED** alone | **Not enough** — requires **both** A4 `[x]` **and** a non-placeholder **Evidence artifact:** under `tmp-release-validation/commercial-evidence/` |
| **Owner attestation:** | Separate human step (name + date + scope note). Placeholders fail closed. Still **not** counsel clearance |
| Evidence markers | Manual bookkeeping only — they do **not** prove BRIA granted rights; a nonempty file is **not** legal permission |
| Evidence path rules | Relative to `commercial-evidence/` only; traversal, absolute escape, symlink escape, empty/whitespace/URL-only files rejected |
| HTTP / marketing pages | HF / bria.ai / go.bria.ai URLs are rejected as evidence |
| Placeholders (`TBD`, `yes`, empty A4 `☐`) | Fail closed as `incomplete` if Status claims RESOLVED |
| Script exit 0 with `--require-commercial` | Outcome = **`evidence_present_pending_review`** + **HUMAN_REVIEW_REQUIRED** — **never** “legally approved” |
| Env / unknown CLI flags | Cannot bypass the gate (`COMMERCIAL_LICENSE_APPROVED`, `--force-approve`, etc. ignored) |

---

## 1. Exact model / weights used in production

| Field | Verified value | Evidence |
| --- | --- | --- |
| App method id | `bg-remove-sdk-rmbg1.4` | `src/lib/mask/bgRemoveSdk.ts` (`BG_REMOVE_SDK_METHOD`) |
| SDK package | `bg-remove-sdk@0.1.0` | `package.json` / `node_modules/bg-remove-sdk/package.json` |
| SDK software license | **MIT** | `node_modules/bg-remove-sdk/LICENSE` |
| Default HF model id | `briaai/RMBG-1.4` | SDK README + HF card |
| Runtime dtype (app) | **`fp16`** | `createBgRemover({ dtype: 'fp16', … })` in `bgRemoveSdk.ts` |
| Primary weight file (browser) | `onnx/model_fp16.onnx` (~**88.2 MB**) | HF tree `briaai/RMBG-1.4/onnx/`; SDK README (~88 MB fp16) |
| Related ONNX siblings (not used by default) | `model.onnx` ~176 MB (fp32), `model_quantized.onnx` ~44.4 MB | Same HF `onnx/` folder |
| Other repo artifacts (not the browser path) | `model.safetensors`, `model.pth`, `pytorch_model.bin`, configs | HF model root |
| Optional override | `VITE_BG_REMOVE_MODEL_ID` → `createBgRemover({ modelId })` | Still must be RMBG-1.4-compatible layout; **does not change license** |

**Inference path:** transformers.js in a Web Worker via `bg-remove-sdk` (`device: 'auto'` → WebGPU or WASM). User images stay on-device; network is used for weight download (HF CDN or a mirror).

---

## 2. SDK license vs model-weights license (must stay separate)

| Layer | License | Commercial use of this layer |
| --- | --- | --- |
| `bg-remove-sdk` **code** | MIT | Permitted under MIT conditions (include copyright notice) |
| **Model weights** `briaai/RMBG-1.4` | `license: other` / **`license_name: bria-rmbg-1.4`** | **Non-commercial / evaluation** unless a **BRIA commercial agreement** is obtained |

SDK README (installed package): *“MIT. Note the bundled model has its own license (briaai/RMBG-1.4) — review before commercial use.”*

**Local / in-browser inference does not convert non-commercial weights into a commercial grant.**

---

## 3. Exact restriction identified (authoritative public terms)

From the Hugging Face model card / README front matter for [`briaai/RMBG-1.4`](https://huggingface.co/briaai/RMBG-1.4) (fetched 2026-10-26):

- Declared as a **source-available model for non-commercial use**.
- License name: **`bria-rmbg-1.4`**.
- Card wording: released under a Creative Commons–style **non-commercial** framing for non-commercial use.
- Card wording: **Commercial use is subject to a commercial agreement with BRIA.**
- Gated access form: “RMBG v1.4 is available as a source-available model for non-commercial use.”
- `license_link` in YAML points to `https://bria.ai/bria-huggingface-model-license-agreement/` — that URL returned **HTTP 404** in this environment (2026-10-26). A **404 is not** evidence that commercial use is allowed; it only means that particular HTML page was unavailable. Prefer the **HF model card text** and any license PDF/files attached to the HF repo / BRIA commercial process.

Commercial purchase / inquiry CTAs referenced on the card:

- https://go.bria.ai/3B4Asxv  
- https://go.bria.ai/3D5EGp0 (also linked from README body)

Both resolve to BRIA lead/forms rather than a signed agreement artifact for this project.

---

## 4. Commercial permission required

Before **commercial catalog / paid SaaS** release that downloads or runs these weights for customer-facing workflows, the product owner must obtain and retain:

1. A **written commercial license / agreement with BRIA** covering RMBG-1.4 (or explicitly covering the ONNX fp16 weights used here).  
2. Clarity on whether the grant covers: end-user browser inference, multi-tenant SaaS, redistribution / CDN mirroring of weights, offline Cache API caching, and territories.  
3. Any required attribution, reporting, or branding clauses.

Until that evidence exists, commercial permission is **not verified**.

---

## 5. Questions for written confirmation from BRIA (owner / counsel)

Use these with BRIA sales/legal (product owner contacts BRIA — **not** this coding agent):

1. Does a commercial agreement for **RMBG-1.4** cover **browser-side ONNX fp16** inference via transformers.js / third-party SDKs such as `bg-remove-sdk`?  
2. May we **mirror / self-host** `onnx/model_fp16.onnx` (+ `config.json`, `preprocessor_config.json`) on our CDN/origin for latency, under the commercial grant?  
3. May end-user browsers **cache** weights via the Cache API on our app origin?  
4. Are there restrictions on **SaaS / multi-tenant** use where customers upload catalog images processed only on-device?  
5. Is **redistribution** of weights inside our installers / `public/` allowed, or only runtime fetch from an approved host?  
6. Required **attribution** text for UI, docs, and About?  
7. Does the grant cover **evaluation → production** transition, or is a separate production SKU required?  
8. Confirm the canonical license document URL / PDF version and effective date (given the prior 404 on the card’s `license_link`).

---

## 6. Checklist — record agreement when the owner obtains it

Store the real agreement offline (private legal store). Optionally place a **local copy** under `tmp-release-validation/commercial-evidence/` for the automated path check (gitignored by default — do **not** commit PDFs unless the owner explicitly intends it). Check items only with real artifacts. **Do not** add sample/fake agreement files.

| # | Item | Status | Evidence location / notes |
| --- | ---: | --- | --- |
| A1 | BRIA counterparty name and contact | ☐ | |
| A2 | Agreement title / product SKU (RMBG-1.4 / commercial) | ☐ | |
| A3 | Effective date and term / renewal | ☐ | |
| A4 | Signed PDF or DocuSign (or equivalent) retained | ☐ | Filename under `commercial-evidence/` |
| A5 | Explicit grant for browser / WASM / WebGPU inference | ☐ | |
| A6 | Explicit grant for CDN / self-host mirroring of ONNX fp16 | ☐ / N/A | |
| A7 | SaaS / multi-tenant allowed | ☐ | |
| A8 | Redistribution limits documented | ☐ | |
| A9 | Attribution / notice text applied in product | ☐ | |
| A10 | Counsel reviewed vs intended catalog workflows | ☐ | |
| A11 | `FINAL_PRODUCTION_READINESS_REPORT.md` licensing section updated with counsel confirmation | ☐ | |
| A12 | This checklist status flipped from UNRESOLVED → **RESOLVED** | ☐ | |
| A13 | **Owner attestation** line filled (name, date, scope) after human review of the actual agreement | ☐ | Still ≠ auto “legally approved” |

**Current gate:** A1–A13 all unchecked → **commercial release remains blocked**.

### Secure evidence + attestation (limitation)

This repository provides **path confinement** and **marker checks** only. It does **not** implement a full legal DMS, e-signature verification, or counsel workflow.

**Authoritative procedure:** [`HUMAN_REVIEW_EVIDENCE_PROCEDURE.md`](./HUMAN_REVIEW_EVIDENCE_PROCEDURE.md) (Product Owner / Legal Counsel / Engineering Lead roles).

Summary: obtain real agreement → counsel scope review → private storage (+ optional `commercial-evidence/` copy) → record decision → update checklist bookkeeping → rerun gate. Treat `evidence_present_pending_review` as bookkeeping only — **not** commercial ship approval.

---

## 7. What this environment will not do

- Fabricate or mark a fake agreement.  
- Contact BRIA while impersonating the product owner.  
- Switch production models to “solve” licensing.  
- Treat a broken agreement URL as permission or as a license repeal.  
- Download/redistribute replacement commercial-alternative weights as a workaround in this phase.
