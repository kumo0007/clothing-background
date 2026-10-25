# Commercial release handoff

**Date:** 2026-10-26 (implementation freeze / external blocker tracking)  
**Repository path:** `tmp-release-validation/COMMERCIAL_RELEASE_HANDOFF.md`  
**Linked report:** `tmp-release-validation/FINAL_PRODUCTION_READINESS_REPORT.md`  
**Commercial verdict:** **NOT READY FOR COMMERCIAL PRODUCTION**

This document is the owner/counsel handoff. It does **not** grant commercial permission.  
Production behavior is **frozen** on `bg-remove-sdk` + BRIA RMBG-1.4 — no model or inference-path changes in this phase.

---

## Separated readiness tracks

| Track | Doc / command | Current status |
| --- | --- | --- |
| **Technical verification** | `npm run verify:release` | Last full run: exit **0**, **312** tests / **48** files (prior pass); freeze pass: focused model/gate tests exit **0** |
| **Commercial authorization** | Checklist + `HUMAN_REVIEW_EVIDENCE_PROCEDURE.md` + `gate:commercial:require` | **UNVERIFIED** / require gate exit **1** |
| **Physical-device validation** | `PHYSICAL_MOBILE_TEST_PLAN.md` | **NOT RUN** (iOS + Android) |
| **Model hosting / deploy** | `MODEL_HOSTING_READINESS.md` | Docs only; self-host **blocked** until commercial rights permit |

---

## Current state

### Technical verification

| Check | Latest observed result |
| --- | --- |
| Production model | `bg-remove-sdk` + BRIA RMBG-1.4 (`bg-remove-sdk-rmbg1.4`, default HF `briaai/RMBG-1.4`, dtype `fp16`) — **frozen** |
| Model ID env | `VITE_BG_REMOVE_MODEL_ID` unset → SDK default; non–RMBG-1.4 IDs rejected |
| `npm run verify:release` | Technical gate (typecheck, lint, tests, build, informational license print) |
| `npm run verify:commercial-release` | Must fail while licensing is UNRESOLVED / attestation or evidence path absent |
| CI workflows | **None** in this repository |

### Commercial licensing

| Item | Status |
| --- | --- |
| Checklist | `BRIA_COMMERCIAL_LICENSE_CHECKLIST.md` → **UNRESOLVED** |
| Human procedure | `HUMAN_REVIEW_EVIDENCE_PROCEDURE.md` |
| Automated gate | Bookkeeping only → at best `evidence_present_pending_review` |
| HUMAN_REVIEW_REQUIRED | Always — exit 0 ≠ legally approved |
| Nonempty evidence file | **Not** proof of legal authorization |

### Physical-device validation

| Platform | Status |
| --- | --- |
| Plan + session templates | `PHYSICAL_MOBILE_TEST_PLAN.md` |
| iOS Safari (physical iPhone) | **NOT RUN** |
| Android Chrome (physical) | **NOT RUN** |
| Emulation as physical evidence | **Forbidden** |

### Model hosting

| Item | Status |
| --- | --- |
| Current load path | HF CDN / Cache API via `bg-remove-sdk` |
| Self-host mirror | **Not deployed**; blocked until agreement allows redistribution/mirroring |

---

## External actions (by role)

| # | Action | Responsible role | Status |
| --- | --- | --- | --- |
| 1 | Obtain written BRIA commercial authorization for RMBG-1.4 weights + intended use | **Product Owner** | Open |
| 2 | Review agreement scope (weights, browser inference, SaaS, self-host, attribution) | **Legal Counsel / authorized reviewer** | Open |
| 3 | Store authoritative evidence in private legal store; optional local copy under `commercial-evidence/` (gitignored) | **Product Owner** (+ Legal ops) | Open |
| 4 | Fill checklist Status / A4 / Evidence artifact / Owner attestation **after** genuine review | **Engineering Lead** (bookkeeping) with Product Owner accountable | Open |
| 5 | Execute physical iOS Safari + Android Chrome matrix; record session + evidence | **QA / device tester** | **NOT RUN** |
| 6 | Self-host weights only if grant explicitly permits; follow `MODEL_HOSTING_READINESS.md` | **Engineering Lead** after Legal OK | Blocked on #1–2 |
| 7 | Re-run `verify:release` + `verify:commercial-release`; update final report with real exits | **Engineering Lead** | After #1–4 (and #5 for mobile claims) |
| 8 | Commercial ship decision | **Product Owner** (Accountable), counsel Consulted | Blocked |

Full procedure: **`HUMAN_REVIEW_EVIDENCE_PROCEDURE.md`**.

---

## Release acceptance criteria

Commercial ship is allowed only when **all** are true:

| # | Criterion | Owner role |
| --- | --- | --- |
| 1 | Written BRIA authorization reviewed and approved for this product’s use | Legal Counsel + Product Owner |
| 2 | Checklist bookkeeping + attestation; commercial gate may show `evidence_present_pending_review`; counsel confirmation recorded privately | Engineering Lead + Legal |
| 3 | `verify:release` passes on the release commit | Engineering Lead |
| 4 | Physical iOS + Android critical scenarios recorded (not emulation) | QA / device tester |
| 5 | No known critical product defects for release scope | Engineering Lead + Product Owner |
| 6 | Final report separates verified facts vs assumptions vs outstanding items | Engineering Lead |

**Until commercial authorization is verified and required physical-device testing is completed, the verdict remains NOT READY FOR COMMERCIAL PRODUCTION.**

---

## What automation does / does not do

| Automation can | Automation cannot |
| --- | --- |
| Fail closed on missing/incomplete bookkeeping | Prove BRIA granted rights |
| Confine evidence paths under `commercial-evidence/` | Replace counsel review |
| Keep physical plan marked NOT RUN in tests | Execute physical device QA |
| Separate technical verify from commercial require | Auto-approve from filenames or file presence |

---

## Quick command reference

```bash
npm run verify:release                 # technical + informational license status
npm run verify:commercial-release      # technical + require bookkeeping + attestation + path
npm run gate:commercial                # print status (does not approve ship)
npm run gate:commercial:require        # exit 0 only for evidence_present_pending_review
```
