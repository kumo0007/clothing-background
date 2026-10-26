# Final production readiness report — Garment Background Studio

**Date:** 2026-10-26 (updated — iPhone 15 Safari stall diagnostics)  
**Production model:** `bg-remove-sdk` + BRIA RMBG-1.4 — **unchanged**  
**Commercial verdict:** **NOT READY FOR COMMERCIAL PRODUCTION**

**Handoff:** [`COMMERCIAL_RELEASE_HANDOFF.md`](./COMMERCIAL_RELEASE_HANDOFF.md)  
**Human evidence procedure:** [`HUMAN_REVIEW_EVIDENCE_PROCEDURE.md`](./HUMAN_REVIEW_EVIDENCE_PROCEDURE.md)  
**iPhone stall diagnostics:** [`IPHONE15_SAFARI_DIAGNOSTIC_REPORT.md`](./IPHONE15_SAFARI_DIAGNOSTIC_REPORT.md)  
**Browser compatibility:** [`BROWSER_COMPATIBILITY_REPORT.md`](./BROWSER_COMPATIBILITY_REPORT.md) — Firefox 131 probe: UI renders; blank page **not reproduced**

**Companion docs:**

- `BRIA_COMMERCIAL_LICENSE_CHECKLIST.md` — **UNRESOLVED**
- `PHYSICAL_MOBILE_TEST_PLAN.md` — physical results **NOT RUN** (session templates ready)
- `MODEL_HOSTING_READINESS.md` — self-host not deployed
- `commercial-evidence/README.md` — permitted evidence directory (gitignored artifacts)

---

## 1. Executive verdict

| Audience | Verdict |
| --- | --- |
| **Commercial catalog / paid SaaS** | **NOT READY FOR COMMERCIAL PRODUCTION** |
| Non-commercial / supervised evaluation | Conditionally ready (accept blockers; QC hard SKUs) |
| “Mobile production ready” | **Not ready** — physical matrix **NOT RUN** |

### Track separation

| Track | Status |
| --- | --- |
| Technical verification | Runnable via `verify:release` (see §2 for latest exits) |
| Commercial authorization | **UNVERIFIED** — human/counsel required |
| Physical-device validation | **NOT RUN** |
| Model hosting / self-host | Blocked until commercial rights permit |

`verify:release` success ≠ commercial approval. File markers / nonempty files / attestation lines ≠ legal permission. Best automated commercial outcome remains `evidence_present_pending_review` (HUMAN_REVIEW_REQUIRED).

**Implementation freeze:** No further production model, inference, threshold, or fallback changes in this repository phase unless a concrete defect is found.

---

## 2. Commands executed (latest — iPhone stall pass)

| Command | Exit | Detail |
| --- | ---: | --- |
| `npm run typecheck` | **0** | |
| `npm test` | **0** | **318** tests / **49** files |
| `npm run build` | **0** | Production build OK |
| Physical iPhone 15 Safari retest | **NOT RUN** | See `IPHONE15_SAFARI_DIAGNOSTIC_REPORT.md` |

Commercial authorization remains **UNVERIFIED**; prior `verify:commercial-release` exit **1** still expected until human review.

### iPhone 15 Safari note

Client stall (`Running model…`, 0 masked / 8 pending) was investigated. **`Running model…` = on-device inference**, not download. In-repo fixes: pending counters exclude in-flight work; worker **recover** after timeout so the batch is not blocked by a hung SDK queue; privacy-safe diagnostics + heartbeat progress. **Not claimed fixed on device** — physical retest required.

---

## 3. External blockers (active)

| ID | Severity | Item | Responsible role |
| --- | --- | --- | --- |
| **L1** | **Critical** | Written BRIA commercial authorization unverified | Product Owner (obtain); Legal Counsel (review) |
| **L2** | High | Physical iOS + Android **NOT RUN** | QA / device tester |
| **L3** | High | Self-host blocked until L1 permits | Engineering Lead after Legal OK |
| **L4** | Medium | Hard-SKU visual QC | Product / Engineering |
| **L5** | Medium | HEIC unsupported | Engineering (product decision) |
| **L6** | Low | No CI config; AGPL `@imgly/*` still in tree (not Batch default) | Engineering Lead |

---

## 4. Evidence review procedure (summary)

See **`HUMAN_REVIEW_EVIDENCE_PROCEDURE.md`** for the full auditable steps:

1. Product Owner obtains real BRIA agreement for RMBG-1.4.  
2. Legal Counsel / authorized reviewer verifies weights, use, distribution, hosting.  
3. Store authoritative copy privately; optional local filename under `commercial-evidence/` (not committed by default).  
4. Record location, reviewer, date, decision privately; update checklist bookkeeping only after genuine review.  
5. Engineering Lead reruns commercial gate; exit 0 still means pending-review bookkeeping, **not** ship approval.

---

## 5. Physical-device status

| Platform | Status |
| --- | --- |
| Plan + session execution templates | Ready in `PHYSICAL_MOBILE_TEST_PLAN.md` |
| iPhone / iOS Safari | **NOT RUN** |
| Android / Chrome | **NOT RUN** |
| Emulation counted as physical | **No** |

---

## 6. Release acceptance criteria

Commercial production ship requires **all** of:

1. Counsel/owner-approved BRIA authorization for this product’s use.  
2. Honest checklist bookkeeping + human confirmation (gate pending-review ≠ auto-approve).  
3. Passing `verify:release` on the ship commit.  
4. Physical iOS + Android critical scenarios executed and recorded.  
5. No known critical defects for the release scope.  
6. This report updated with verified facts only.

---

## 7. Docs touched (this freeze pass)

| Path | Reason |
| --- | --- |
| `HUMAN_REVIEW_EVIDENCE_PROCEDURE.md` | Secure, role-based human review procedure |
| `COMMERCIAL_RELEASE_HANDOFF.md` | Track separation + RACI external actions |
| `PHYSICAL_MOBILE_TEST_PLAN.md` | Session execution record templates |
| `FINAL_PRODUCTION_READINESS_REPORT.md` | This freeze / blocker tracking update |

Production inference code intentionally **not** modified.

---

**Final commercial verdict remains: NOT READY FOR COMMERCIAL PRODUCTION.**
