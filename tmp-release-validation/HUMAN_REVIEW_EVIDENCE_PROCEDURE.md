# Human-review evidence procedure — BRIA RMBG-1.4 commercial authorization

**Audience:** Product Owner, Legal Counsel / authorized reviewer, Engineering Lead  
**Related:** `BRIA_COMMERCIAL_LICENSE_CHECKLIST.md`, `commercial-evidence/README.md`, `scripts/assertCommercialReleaseGate.mts`  
**Rule:** Automated gates check **bookkeeping only**. They never establish that BRIA granted commercial rights.

---

## Distinction (mandatory)

| Layer | Who | What it means |
| --- | --- | --- |
| Evidence presence | Automated script | Checklist markers + file under `commercial-evidence/` + owner attestation line → at best `evidence_present_pending_review` |
| Legal approval | Authorized human | Counsel/owner confirms the **actual agreement** covers this product’s weights and use |
| Commercial ship | Product Owner | Only after legal approval **and** other acceptance criteria in the handoff |

Do **not** treat filenames, marker strings, file size, or `verify:commercial-release` exit 0 as legal approval.

---

## Procedure

### Step 1 — Obtain authorization  
**Responsible:** Product Owner (contacts BRIA; agent sessions must not impersonate the owner)

1. Request a written commercial license/agreement covering **`briaai/RMBG-1.4`** / `onnx/model_fp16.onnx` (browser fp16 ONNX).  
2. Retain the executed PDF, DocuSign package, or equivalent written grant.  
3. Record counterparty name, effective date, and document version (checklist A1–A3).

### Step 2 — Verify scope against this product  
**Responsible:** Legal Counsel or other authorized reviewer; Product Owner confirms intended use

Confirm in writing that the grant covers (or explicitly excludes):

| Topic | Product fact to match |
| --- | --- |
| Exact weights | RMBG-1.4 ONNX fp16 (~88 MB), not a different BRIA SKU |
| Inference | End-user **browser** / WASM / WebGPU via `bg-remove-sdk` / transformers.js |
| Distribution | Runtime fetch from HF and/or **self-host / CDN mirror** (only if permitted) |
| Caching | Browser Cache API on the app origin |
| Business model | Catalog / multi-tenant SaaS if applicable |
| Territories / term | Match go-to-market plan |
| Attribution | Any required notices |

Use checklist questions in `BRIA_COMMERCIAL_LICENSE_CHECKLIST.md` §5.

### Step 3 — Secure storage (do not put secrets in Git by default)  
**Responsible:** Product Owner / Legal ops

1. Store the **authoritative** agreement in the organization’s private legal store (DMS, counsel vault, etc.).  
2. Optionally place a **local copy** under `tmp-release-validation/commercial-evidence/` for path bookkeeping. That directory is **gitignored** for artifacts by default.  
3. Do **not** commit credentials, API keys, or confidential agreements unless the Product Owner explicitly decides to version them.  
4. Do **not** add sample/fake “agreement” files that could be mistaken for a grant.  
5. Do **not** paste agreement body text into CI logs or public issues.

### Step 4 — Record review decision (auditable)  
**Responsible:** Authorized reviewer; Product Owner co-signs ship decision

In a **private** tracker or legal memo (not necessarily this repo), record:

| Field | Example content |
| --- | --- |
| Evidence location | Private path / ticket ID (and optional local filename under `commercial-evidence/`) |
| Reviewer role + name | Legal Counsel / Product Owner — real person |
| Review date | ISO date |
| Decision | Approved for intended use / Rejected / Conditional (list conditions) |
| Scope notes | Browser inference, SaaS, self-host Y/N, attribution |

Then update the **repo checklist** (bookkeeping only):

1. Set `**Status:** **RESOLVED**` only when A4 evidence exists.  
2. Check A4 `[x]`.  
3. Set `**Evidence artifact:**` to a filename **inside** `commercial-evidence/` (not a marketing URL).  
4. Set `**Owner attestation:**` to a non-placeholder line: name, date, short scope note.  
5. Keep `FINAL_PRODUCTION_READINESS_REPORT.md` commercial verdict as **NOT READY** until counsel decision is **Approved** for ship **and** physical criteria are met (or residual risk accepted in writing).

### Step 5 — Rerun gates after genuine review  
**Responsible:** Engineering Lead

```bash
npm run verify:release
npm run verify:commercial-release
```

Interpret exit codes:

| Exit | Meaning |
| --- | ---: |
| `verify:release` = 0 | Technical checks OK; licensing may still be unresolved |
| `verify:commercial-release` = 1 | Bookkeeping incomplete or still UNRESOLVED |
| `verify:commercial-release` = 0 | **`evidence_present_pending_review` only** — counsel must still have approved scope for ship |

Engineering must not flip the final report to commercial-ready based on exit 0 alone.

---

## Roles (RACI summary)

| Action | Product Owner | Legal Counsel / authorized reviewer | Engineering Lead | QA / device tester |
| --- | --- | --- | --- | --- |
| Obtain BRIA agreement | **R** | C | I | — |
| Scope / legal review | A | **R** | C | — |
| Secure evidence storage | **R** | C | C | — |
| Checklist bookkeeping | A | C | **R** | — |
| Rerun commercial gate | I | I | **R** | — |
| Physical device matrix | A | — | C | **R** |
| Commercial ship decision | **A/R** | C | C | C |

R = Responsible, A = Accountable, C = Consulted, I = Informed.
