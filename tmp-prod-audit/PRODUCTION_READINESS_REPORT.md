# RELEASE FREEZE — Clothing Background Replacement

**Date:** 2026-10-24  
**Status:** **GO — limited supervised client delivery (FROZEN)**

| Mode | Decision |
| --- | --- |
| Limited supervised delivery | **GO (freeze)** |
| Universal unattended segmentation | **NOT READY** |
| Commercial hosted ISNet | **CONDITIONAL** — AGPL-3.0 legal review required |

No release-blocking regressions found on this freeze pass. **No production code changes** were required; implementation left unchanged.

---

## Freeze verification (this pass)

| Check | Result |
| --- | --- |
| `npx vite-node scripts/evalBeachComposite.mts` | Pass — 10/10 leak=0.000 |
| `npx vitest run` | **212 passed** (28 files) |
| `npx tsc --noEmit` / `npm run build` | Pass |
| `npx vite-node scripts/auditProductionReadiness.mts` | Pass (ISNet Node ok) |
| Beach inset on `13_beach.jpg` | `{ bottom: 8 }` → trim ~row **178** |
| Composite bottom mean luminance | **~242.7** (sand; not ~254 white footer) |
| Studio REMOVE leak metric | **0.000** on all ten ISNet×beach composites |

Artifacts: `tmp-beach-audit/`, `tmp-isnet-refine/`, this report.

---

## Preserved release features

- Default **Lab-seed**; opt-in **ISNet** (`methodUsed = isnet-onnx`)
- Evidence-guided refine (`refineIsnetWithEvidence`) + large-under-recall review gate
- Beach environment near-white footer trim (`measureUniformBorderInset` / `drawBackgroundImage`)
- Review UI: gallery badges, amber borders, batch review count, selected-image reasons
- Manual brush/polygon, undo/redo, batch isolation, PNG/JPEG/ZIP export
- Mask polarity 255 KEEP / 0 BG / gray soft; source RGB preserved

Edge-case tests retained: no-border → zero inset; over-crop guard keeps ≥4×4 content.

---

## Mandatory supervised QC

Flagged on current fixtures (`needsReview = true`):

| Image | Reason class |
| --- | --- |
| White tee | Pale / white-on-near-white |
| Sneakers | Pale boundaries |
| Coat | Large under-recall boundary QC |
| Cap | Residual dark edge bites |
| Handbag | Ambiguous openings / gaps |
| Any Review badge | Operator must inspect |

**Not auto-approved:** hoodie/blazer/jeans pass on this set without review, but batch completion ≠ visual approval for flagged items.

Known residual limits (documented, not “solved”): soft halos, coat hem noise, pale tee/sneaker edges, cap bites, handbag openings, Lab-seed studio-card KEEP risk on hard tees.

---

## Deployment prerequisites

| Path | Requirements |
| --- | --- |
| Lab-seed (default) | Modern browser; no ISNet model download required |
| Browser ISNet | `npm run fetch:imgly-data` → assets under `public/imgly-bg-data/1.7.0/` (present) |
| Build | `npm run build` → static `dist/` |
| Secrets | None required for core local client workflow |

### Licensing (not legal clearance)

| Package | Version | License |
| --- | --- | --- |
| `@imgly/background-removal` | 1.7.0 | AGPL-3.0 |
| `@imgly/background-removal-node` | 1.4.5 | AGPL-3.0 |

**Commercial hosted ISNet remains conditional on qualified legal review.** Do not treat this report as AGPL clearance.

---

## Client handover (concise)

**What ships:** Local garment background studio — upload/batch auto-mask (Lab-seed default or ISNet), mask edit with undo, background replace (including beach), adjust/export, PNG/JPEG/ZIP.

**Verified fix:** Beach JPEG white footer no longer appears as a bottom bar after environment inset crop; sand shows at bottom (~L 243).

**How to use safely:** After auto-mask, clear every **Review** badge (tee, sneakers, coat, cap, handbag, others). Correct with brush/polygon; preview; then export.

**What is not promised:** Perfect automatic cutouts on every SKU; unattended white-on-white; commercial SaaS ISNet without counsel.

**Freeze recommendation:** Ship this supervised build; do not continue segmentation experimentation without a new reproduced blocker.
