# Release-blocker investigation

**Date:** 2026-10-26  
**Basis:** `FINAL_RELEASE_READINESS_AUDIT.md` + fresh probes this session  
**Commercial-release decision:** **NO — not cleared** (licensing blocker remains)

Verified facts vs assumptions are labeled. Physical-device tests are **not claimed as passed**.

---

## 1. Licensing (authoritative)

### Installed package

| Item | Verified value |
| --- | --- |
| npm dependency | `bg-remove-sdk@^0.1.0` (`package.json` / lock) |
| Installed version | **0.1.0** (`node_modules/bg-remove-sdk/package.json`) |
| Package license | **MIT** (`node_modules/bg-remove-sdk/LICENSE`) |
| Package README | Explicitly: bundled model has **its own** license; review before commercial use |
| Default model id | `briaai/RMBG-1.4` (SDK README / HF) |

### RMBG-1.4 model terms (from Hugging Face model card + BRIA materials)

| Topic | Documented term |
| --- | --- |
| License name | `bria-rmbg-1.4` / “other” on HF |
| Non-commercial | Source-available for **non-commercial** use; model card also references Creative Commons-style non-commercial wording |
| Commercial use | **Requires a commercial agreement with BRIA** ([HF card](https://huggingface.co/briaai/RMBG-1.4), commercial CTA e.g. [go.bria.ai](https://go.bria.ai/3B4Asxv)) |
| Agreement text | BRIA Hugging Face model license for non-commercial / evaluation: time-limited, non-exclusive, non-sublicensable, evaluation/testing only; **no sell/rent/host/distribute** of the foundation model ([License.pdf on HF revisions](https://huggingface.co/briaai/RMBG-1.4); agreement portal [bria.ai/…](https://bria.ai/bria-huggingface-model-license-agreement/) — page returned 404 to automated fetch this session; use HF PDF + BRIA portal as source of truth) |
| Attribution | Cite BRIA / model card for research; Apache-style notice **not** a substitute for BRIA commercial grant |
| Redistribution of weights | Restricted under non-commercial evaluation terms; commercial redistribution needs BRIA permission |
| Local browser execution | **Does not waive** commercial restrictions |

**Assumption (not legal advice):** Shipping this app to paying catalog customers while downloading/running RMBG-1.4 without a BRIA commercial license is a **release blocker**. Counsel should review the signed BRIA agreement before production.

### Technically compatible alternatives (evaluated, **not integrated**)

Do **not** switch models in this investigation (pipeline rewrite out of scope). Options with **verified-looking commercial-friendly licenses** for a future commercial path:

| Candidate | Approx size | License (claimed upstream) | Fit notes |
| --- | --- | --- | --- |
| U²-Netp ONNX (`edgetools/u2netp` / rembg lineage) | ~4.4 MB | Apache-2.0 | Fast cold-start; quality below RMBG on hard e-com |
| BiRefNet-lite 512 (`studioludens/birefnet-lite-512`) | ~98 MB fp16 | MIT | Strong general objects; different preprocess than RMBG |
| ISNet general q8 / MIT redistributions | ~44 MB | MIT / Apache (verify exact repo) | Faster; more haze/false KEEP risk |
| MODNet (`Xenova/modnet`) | ~26 MB | Apache-2.0 | People/pets — **poor** for garments/products |

**imgly `@imgly/background-removal` remains AGPL-3.0** in this repo’s lockfile — not a commercial-safe drop-in without AGPL compliance.

---

## 2. Cold-start performance

### Evidence (prior cold probe + this session warm timing)

| Phase | Cold (caches cleared, 10 fixtures) | Warm (2 fixtures, this session) |
| --- | --- | --- |
| HF download `model_fp16.onnx` | ~0→100% over ~**140+ s** (timeline in prior audit) | Not observed |
| Model ready after Auto-mask | ~**155 s** | Init→ready ~**6.7 s** (`getBgRemoveTimingSnapshot`) |
| Per-image process sum | Remainder of ~188 s wall (~**33 s** for 10 after ready) | **7.7 s** for 2 (`totalProcessMs`) |
| Last single process | — | **3.5 s** |

**Root cause of ~155–188 s cold:** almost entirely **network download of ~88 MB fp16 ONNX from Hugging Face**, not per-image inference. Inference on these fixtures is seconds each once ready.

### Safe optimizations implemented (no quality change)

1. **Background preload on first upload** — overlaps download with CTA reading (single shared `BgRemover`; no duplicate model instances).
2. **Progress copy** — `formatInitProgressLine` distinguishes download vs initialize.
3. **Phase timing snapshot** — `getBgRemoveTimingSnapshot()` (+ `?audit=1` bridge) for ops measurement.
4. **Optional self-host** — `VITE_BG_REMOVE_MODEL_ID` passed to `createBgRemover({ modelId })` so a CDN mirror can replace HF cold latency without changing the algorithm.

### Not done (would need product/ops work)

- Vendoring weights into `public/` / own CDN (recommended for production latency).
- Changing dtype to fp32 (worse download).
- Parallel inference (rejected — mobile memory).

---

## 3. Physical-device validation plan (**requires hardware — not run**)

Use production build (`npm run build && npm run preview`) or deployed HTTPS origin. Open `/?audit=1` for `__garmentAudit`.

| # | Test | iPhone Safari | Android Chrome | Pass criteria |
| --- | --- | --- | --- | --- |
| P1 | First-run cold download on Wi‑Fi | ☐ Required | ☐ Required | Progress shows download %; completes or actionable timeout; no silent 0 masked |
| P2 | First-run on cellular | ☐ Required | ☐ Required | Same; document MB / minutes |
| P3 | Warm restart (kill tab, reopen) | ☐ Required | ☐ Required | No full re-download; batch &lt; ~2 min for 8 thumbs |
| P4 | 8 real camera JPEGs (multi‑MP) | ☐ Required | ☐ Required | All upload; Auto-mask all; counters match; export ZIP |
| P5 | Memory pressure (8× large + background apps) | ☐ Required | ☐ Required | Failures named; Retry failed works; no tab death without message |
| P6 | Forced failure (offline mid-init) | ☐ Required | ☐ Required | Queue marked failed; Retry after online |
| P7 | Manual edit then Auto-mask all | ☐ Required | ☐ Required | Edited mask not overwritten |
| P8 | Undo/redo in Edit Mask | ☐ Required | ☐ Required | History intact after export preview |
| P9 | HEIC from Camera roll | ☐ Required | ☐ If offered | Safari may decode; Chrome shows conversion error |
| P10 | Export PNG/JPEG ZIP after partial failure | ☐ Required | ☐ Required | Successful images exportable |

**Status:** All rows **unverified** on physical devices as of this report.

---

## 4. Quality: tee / sneakers (Lab-seed vs live RMBG)

### Lab-seed proxy (Node, this session)

See `tee-sneaker-labseed-vs-neural.json`.

| Fixture | Lab KEEP% | Lab flag | Neural on **same Lab mask** |
| --- | --- | --- | --- |
| `03_tshirt.jpg` | 62.9% | `border_studio_leak` 0.122 &gt; 0.08 | Also forces review |
| `08_sneakers.jpg` | 13.4% | `fragmented_keep` 0.69; fringe; pale | `fragmented_keep` forces review |

### Live RMBG (browser warm, `?audit=1`, this session)

See `tee-sneaker-live-rmbg.json`.

| Fixture | RMBG KEEP% | soft% | needsReview | findings |
| --- | --- | --- | --- | --- |
| `03_tshirt.jpg` | **47.3%** | 3.27 | **false** | none |
| `08_sneakers.jpg` | **32.0%** | 4.37 | **false** | none |

### Conclusion (evidence-based)

- Lab-seed warnings reflect **Lab silhouettes** (card bleed / fragmentation), not proof that neural rules ignore defects on **RMBG** masks for these fixtures.
- Live RMBG masks differ materially (tee KEEP ↓, sneakers KEEP ↑ and coherent).
- **No threshold change.** Operator visual QC still required for pale garments, straps, handbags; do not chase zero-review badges.

---

## 5. HEIC

| Approach | Decision |
| --- | --- |
| Bundle `heic2any` / libheif WASM | **Rejected for now** — large decode cost, orientation edge cases, memory on phones |
| Native try-decode | **Implemented** — HEIC candidates attempted via `HTMLImageElement`; Safari may succeed; Chrome fails with clear JPEG export guidance |
| Accept attribute | Still lists JPEG/PNG/… (pickers may still hand HEIC) |

---

## 6. Code changes this investigation

| Change | Why |
| --- | --- |
| Upload-time `preloadBgRemoveModel` | Overlap cold download with CTA |
| `bgRemoveTiming` + clearer progress | Separate download / init / process measurement |
| `VITE_BG_REMOVE_MODEL_ID` | Self-host mirror without pipeline rewrite |
| HEIC try-native + stronger error | Better Safari path; keep conversion guidance |
| `?audit=1` → `window.__garmentAudit` | Repeatable quality / device probes |
| Tests updated | 280 passing |

**Unchanged:** segmentation model, neural thresholds, mask polarity, manual-edit safeguards, preview/export parity.

---

## 7. Remaining blockers & commercial decision

| ID | Blocker | Status |
| --- | --- | --- |
| L1 | BRIA commercial license for RMBG-1.4 | **Open — blocks commercial release** |
| L2 | Cold HF download latency | Mitigated (preload, progress, mirror env); still slow without CDN |
| L3 | Physical iPhone/Android matrix | **Open — plan only** |
| L4 | HEIC on Chrome/Android | Accepted limitation + guidance |
| L5 | Visual QC on hard SKUs | Process requirement (not automated green) |

### Explicit commercial-release decision

**Do not ship commercially** until **L1** is satisfied (signed BRIA license **or** replacement model with verified commercial terms + quality parity sign-off).  

**Non-commercial / internal supervised evaluation:** allowable under BRIA non-commercial terms **if** counsel agrees; still complete **L3** before claiming mobile production readiness.

---

## 8. Verification this session

- `npm test` → **280** passed  
- `npm run typecheck` / `npm run build` → pass  
- Lab-seed tee/sneaker JSON written  
- Live RMBG tee/sneaker metrics written  
- Physical devices: **not tested**
