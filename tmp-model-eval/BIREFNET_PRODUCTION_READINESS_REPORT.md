# BiRefNet production-readiness report

**Date:** 2026-10-28  
**Baseline:** `tmp-model-eval/BIREFNET_FINAL_INDEPENDENT_VERIFY_2026-10-27.md`  
**Artifacts:** `tmp-model-eval/birefnet-production-readiness-2026-10-28/`  
**Model path:** unchanged (`segmentWithBirefNet` → WASM BiRefNet_lite 512). WebGPU not re-enabled. No second segmentation model.

**Do not claim perfect background removal or commercial license clearance.**

---

## Verdict

Production Batch/UI auto-mask remains **BiRefNet-only (WASM)**. Fixture KEEP% matched the independent-verify baseline exactly (Δ = 0 on all five). Cleanup / boundary utilities were measured against raw BiRefNet and **none were enabled** — every candidate either regressed or lacked proven gain without ground truth.

One **reproducible UX defect** was fixed: BiRefNet init/inference failures no longer surface RMBG-oriented copy (`~44MB` / `RMBG-1.4`). Segmentation thresholds, weights, and postprocess are unchanged.

---

## 1. Baseline reproduction

| Gate | Result |
| --- | --- |
| Independent-verify fixture KEEP% | **Exact match** (55.43 / 49.04 / 34.5 / 35.68 / 73.89) |
| Weight SHA-256 | `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516` (verified) |
| Tests at start of pass | **399** passed / 1 skipped |
| Tests after narrow fix | **400** passed / 1 skipped (+1 unit test for BiRefNet error formatter) |
| typecheck | pass |
| lint | pass (pre-existing warnings only) |
| production build | pass — `birefNet-*.js` + ORT; no `bgRemoveSdk` client chunk |
| `validate:birefnet-weights` | `allOk: true` |

Reproduce:

```bash
npx tsx scripts/evalBirefNetProductionReadiness.mts
npx tsx scripts/benchBirefNetBrowserProd.mts   # needs build + system Chrome
npm run typecheck && npm test && npm run lint && npm run build && npm run validate:birefnet-weights
```

---

## 2. Failure-region inspection (observed, not GT)

No pixel-perfect ground-truth masks. Proxies + visual composites over white/black/gray/magenta.

| Fixture | Missing-garment proxy | Retained-background proxy | Observed notes |
| --- | --- | --- | --- |
| dark-hoodie (`01_hoodie`, beige/cream) | pale REMOVE near KEEP 4.6% of REMOVE | border KEEP = 0 | Clean silhouette; soft α 5.1% |
| white-tshirt | pale near-KEEP **5.0%**; soft α **3.3%** | border KEEP = 0 | Soft/jagged sleeve & hem fringe on magenta; white-on-light hard case |
| white-sneakers | pale near-KEEP **3.7%**; soft α **2.6%** | border KEEP = 0 | Lace gaps OK; faint sole fringe |
| open-handbag | pale near-KEEP 7.6% (studio card) | internal hole ratio **6.2%** | Handle/strap openings expected — not treated as garment bites |
| polo-carpet-closeup | pale near-KEEP 0 | border KEEP **59%**; textured border KEEP **7.3%** | Fill-the-frame crop; carpet risk at frame edges; tags/string kept |

**Separation:** white-tshirt / sneakers failures are dominated by **soft / bitten fringe** (missing or uncertain garment edge pixels), not dense retained studio. Polo close-up risk is **frame-touch KEEP + textured border** (possible carpet), not interior holes.

Composites/cutouts: `birefnet-production-readiness-2026-10-28/{transparent,composites,masks}/`.

---

## 3. Cleanup / boundary evaluation vs raw BiRefNet

Criteria: reject if IoU vs raw &lt; 0.985, \|Δkeep\| &gt; 1.5%, border KEEP↑ &gt; 2%, or RGB mutated. No blind `repairSdkUnderRecall`.

| Candidate | Mean IoU vs raw | Material regressions | Decision |
| --- | ---: | ---: | --- |
| morphOpen-r1 | 0.9998 | 0/5 | **Reject** — no objective gain |
| morphClose-r1 | 0.9989 | 0/5 | **Reject** — unproven without GT |
| fillMaskHoles | 0.9706 | **1/5** | **Reject** |
| feather-r1 | 1.0000 | 0/5 | **Reject** — cosmetic only; no proven quality lift |
| refineSilhouetteBoundary | 0.9859 | **1/5** | **Reject** |
| refineBoundaryAlpha | 0.9845 | **3/5** | **Reject** |
| repairSdkUnderRecall | 0.8964 | **4/5** | **Reject** (would grow KEEP ~4–11% on white cases) |

Diffs: `cleanup-diffs/*__*.png` (red = gained KEEP, cyan = lost KEEP).

**Production decision:** leave `segment.ts` without cleanup / under-recall. Manual brush/polygon remain available.

---

## 4. RGB, polarity, preview/export parity

| Check | Result |
| --- | --- |
| Convention | **255 = KEEP, 0 = background** (center α ≫ border α on product shots) |
| Garment RGB on opaque KEEP | **unchanged** on all five fixtures |
| Transparent PNG | same dims as source; α from mask only |
| Composites | white / black / gray / magenta written for each fixture |
| Preview vs export | same `maskStore` buffer; no alternate engine on export |

---

## 5. Browser timings (Chromium / system Chrome, WASM)

Source: `birefnet-production-readiness-2026-10-28/browser-bench.json` (measured, not estimated).

| Metric | Measured |
| --- | ---: |
| Cold session create | **14 456 ms** |
| Warm reuse (same session, first fixture again) | **12 113 ms** |
| Sequential batch (5 fixtures) total infer | **60 351 ms** |
| Per-image infer (ms) | 12178 / 11540 / 12117 / 12838 / 11678 |
| JS heap after init (`performance.memory`) | **102.3 MB** used |
| Peak used JS heap recorded in harness | **102.3 MB** (post-init); mid-batch samples 9–29 MB after GC |
| Session reuse | **yes** (single WASM session for batch) |
| Method id | `birefnet-lite-512` (`notSilentRmbg: true`) |

Node WASM sequential (eval script, same machine): init **9595 ms**, first infer **11679 ms**, warm reuse **10945 ms**, 5-image total **55 935 ms**. RSS peak ~2.4 GB (ORT WASM process; not browser heap).

---

## 6. Failure paths

| Probe | Result |
| --- | --- |
| Missing model URL (browser) | throws; **no competing model** |
| All-negative logits | `logitsLookDegenerate: true`; `assertUsableMask` throws empty-KEEP error |
| BiRefNet throw in `autoMaskCorners` | rejects; no RMBG/Lab/ISNet fallback (unit-tested) |
| Preload fail in App | queue marked failed + `upload-error`; no false success |
| Batch cancel / Clear all | `batchGenerationRef` bumps; in-flight updates ignored (no false success write) |
| Error copy | now BiRefNet / ~94MB — **not** RMBG / ~44MB |

---

## 7. Legacy dependency audit

| Package | Production App Batch path | Tests / scripts | Action |
| --- | --- | --- | --- |
| `onnxruntime-web` | **required** | required | keep |
| `fflate` / `react` / `react-dom` | required | required | keep |
| `bg-remove-sdk` | **not** imported by App auto-mask | tests + legacy `bgRemoveSdk.ts` | **keep** — not proven removable without rewriting tests/scripts |
| `@imgly/background-removal(+node)` | not on App auto path | ISNet scripts/tests | **keep** |
| `@techstark/opencv-js` | not on App auto path | OpenCV/Lab scripts/tests | **keep** |

No unrelated upgrades. No package removed this pass (would break the 399+/test + script surface).

---

## 8. Code changes this pass

| Change | Why |
| --- | --- |
| `src/lib/mask/birefNet/errors.ts` + App wiring | Failures must name BiRefNet / ~94MB weights; never RMBG copy |
| App static `isAppleMobileUserAgent` import | Removes ineffective dynamic import of `bgRemoveDevice` |
| Unit test for formatter | Guards against RMBG wording regression |
| Eval/bench scripts + CORP on verify/bench static servers | Measurement only; production Vite still avoids COEP (intentional) |

**Not changed:** BiRefNet weights, preprocess, logits→mask, thresholds, WebGPU policy, `repairSdkUnderRecall` (still off on BiRefNet).

---

## 9. Regressions vs baseline fixtures

| Fixture | Baseline KEEP% | This pass KEEP% | Δ |
| --- | ---: | ---: | ---: |
| dark-hoodie | 55.43 | 55.43 | 0 |
| white-tshirt | 49.04 | 49.04 | 0 |
| white-sneakers | 34.5 | 34.5 | 0 |
| open-handbag | 35.68 | 35.68 | 0 |
| polo-carpet-closeup | 73.89 | 73.89 | 0 |

No cleanup applied → no mask-quality regression from postprocess churn.

---

## 10. Remaining issues / release blockers

| Item | Severity | Notes |
| --- | --- | --- |
| **DIS5K / training-data commercial review** | **Release policy blocker** | Separate from code; do not claim legal clearance |
| White-on-light soft fringe (tee, sneakers) | Product quality | Manual brush may be required; auto is not perfect |
| Polo-on-carpet close-ups | Product quality | High border KEEP; inspect textured edges; some polo set still manual-required historically |
| Warm WASM ~11–13 s / image | UX | Session reused; large batches still slow |
| WebGPU | Ops | Remains disabled / unusable on this host |
| Legacy npm packages | Hygiene | Still needed for tests/scripts; not on App Batch import graph |
| Tape / hangtags / props | Quality | Often KEEP — intentional product content or manual remove |

---

## 11. Assumptions vs observations

**Observed:** KEEP% parity, RGB integrity, cleanup IoU table, browser cold/warm/batch timings, init-failure throw, empty-mask assert, build chunk list, test counts.

**Assumptions / proxies:** pale-near-KEEP and textured-border metrics are **not** ground truth; visual fringe notes are from magenta composites; browser heap is Chromium `performance.memory` on this host only.
