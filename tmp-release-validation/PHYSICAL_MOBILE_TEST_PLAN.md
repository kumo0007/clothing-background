# Physical mobile validation plan

**Date:** 2026-10-26  
**Status:** **PLAN ONLY — no physical-device results recorded.**  
**Rule:** Emulation (e.g. Chromium 390×844) is **not** a substitute. Do not mark iOS/Android rows PASS from desktop/browser MCP probes. Do not fabricate screenshots or timings.

**Build under test:** `npm run build && npm run preview` (or same commit on HTTPS). Prefer `/?audit=1` for timing helpers when available.

**Production model (must remain):** `bg-remove-sdk` + RMBG-1.4 (`bg-remove-sdk-rmbg1.4`). Do not switch models for these tests.

**Result vocabulary:** `PASS` | `FAIL` | `BLOCKED` | `NOT RUN`  
All scenario results below start as **NOT RUN**.

---

## Environment matrices

### Device A — iOS Safari (physical iPhone)

| Field | Value |
| --- | --- |
| Device model | _e.g. iPhone 14_ |
| OS version | _e.g. iOS 18.x_ |
| Browser + version | Safari _x.y_ |
| Network | Wi‑Fi / cellular (note) |
| Tester | |
| Build URL / commit | |
| Evidence folder | `tmp-release-validation/physical-ios/<YYYY-MM-DD>/` |
| Cold model load (s) | NOT RUN |
| Warm model load (s) | NOT RUN |
| Approx download size | NOT RUN |

### Device B — Android Chrome (physical Android)

| Field | Value |
| --- | --- |
| Device model | |
| OS version | |
| Browser + version | Chrome _x.y_ |
| Network | |
| Tester | |
| Build URL / commit | |
| Evidence folder | `tmp-release-validation/physical-android/<YYYY-MM-DD>/` |
| Cold model load (s) | NOT RUN |
| Warm model load (s) | NOT RUN |
| Approx download size | NOT RUN |

### Control — Desktop Chrome

| Field | Value |
| --- | --- |
| OS | |
| Chrome version | |
| Network | |
| Tester | |
| Build URL / commit | |
| Evidence folder | `tmp-release-validation/physical-desktop-control/<YYYY-MM-DD>/` |
| Cold model load (s) | NOT RUN |
| Warm model load (s) | NOT RUN |

**Prior emulation (not physical):** `PRODUCTION_AUDIT_BROWSER_EVIDENCE.json`, `MOBILE_BATCH_FIX_EVIDENCE.json` — expected-behavior references only.

---

## Shared fixtures

- `public/testdata/clothing/01_hoodie.jpg` … `10_cap.jpg` (use **≥ 8** for batch)
- Hard cases: `03_tshirt.jpg`, `07_dress.jpg` / slip dress, `08_sneakers.jpg`, `09_handbag.jpg`, `06_sweater.jpg`
- Optional: 2–3 real multi‑MP camera JPEGs from the device
- Screenshots: `T##_ios.png`, `T##_android.png`, `T##_desktop.png` in the evidence folder

---

## Per-scenario log template (copy per ID)

```text
ID:
Platform: iOS | Android | Desktop
Procedure:
Expected:
Actual: NOT RUN
Result: NOT RUN
Evidence: (screenshot / zip / notes path)
Cold/warm notes: (if applicable)
```

---

## Session execution record (fill on real devices only)

Copy one block per physical session. Leave blank / NOT RUN until executed. Emulators and desktop DevTools device mode are **not** valid for iOS/Android rows.

### Session — iPhone / iOS Safari

| Field | Value |
| --- | --- |
| Test date | NOT RUN |
| Tester (role: QA / device tester) | |
| Device model | |
| OS version | |
| Safari version | |
| Build URL / git commit | |
| Network | |
| Batch: ≥8 images processed | NOT RUN |
| Retry / cancel / recovery (T05, T22) | NOT RUN |
| Brush + polygon + undo/redo (T12–T14) | NOT RUN |
| PNG / JPEG / ZIP integrity (T16–T18) | NOT RUN |
| Cold-start model load (T23) | NOT RUN |
| Warm-start / cached load (T24) | NOT RUN |
| Evidence folder (screenshots, exports) | `tmp-release-validation/physical-ios/<YYYY-MM-DD>/` |
| Overall session | **NOT RUN** |

### Session — Android / Chrome

| Field | Value |
| --- | --- |
| Test date | NOT RUN |
| Tester (role: QA / device tester) | |
| Device model | |
| OS version | |
| Chrome version | |
| Build URL / git commit | |
| Network | |
| Batch: ≥8 images processed | NOT RUN |
| Retry / cancel / recovery (T05, T22) | NOT RUN |
| Brush + polygon + undo/redo (T12–T14) | NOT RUN |
| PNG / JPEG / ZIP integrity (T16–T18) | NOT RUN |
| Cold-start model load (T23) | NOT RUN |
| Warm-start / cached load (T24) | NOT RUN |
| Evidence folder (screenshots, exports) | `tmp-release-validation/physical-android/<YYYY-MM-DD>/` |
| Overall session | **NOT RUN** |

**PASS / FAIL / BLOCKED** must be written into the scenario table rows below; do not invent PASSes.

---

## Scenario checklist

| ID | Procedure | Expected result | iOS result | Android result | Desktop result | Actual (summary) | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | Upload ≥8 supported clothing images via picker | All in gallery; **no** auto-inference; pending labels | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T02 | Observe Batch panel after upload; do **not** tap Start yet | Pending > 0; CTA **Start Auto-mask all**; masked = 0 | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T03 | Tap **Start Auto-mask all** / Auto-mask all for ≥8 images | Progress updates; successes = masked count; method `bg-remove-sdk-rmbg1.4` | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T04 | Watch thumbnails during T03 | pending → processing → done/failed; batch progress text matches | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T05 | Force one failure (offline mid-run if possible); tap **Retry failed** | Only failed re-run; successes not overwritten | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T06 | Inspect any failure UI | Actionable timeout/init/OOM text; no silent 0 masked | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T07 | QC white tee / pale garment cutout | Document leakage/card/soft fringe (PASS ≠ empty Review) | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T08 | QC white sneakers | Coherent silhouette; sole/lace notes | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T09 | QC thin straps | Straps present; note breaks/halos | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T10 | QC handbag handles / openings | Openings cleared or flagged; handles kept | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T11 | QC dark knit / coat hem | Halo notes; garment RGB looks unchanged | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T12 | Edit Mask → brush KEEP/REMOVE | Mask + preview update | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T13 | Polygon fill on one image | Polygon applies; other images unchanged | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T14 | Undo then redo after brush/polygon | Prior mask restored; redo works after mode switch | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T15 | Edit image A; open image B | B mask unchanged (isolation) | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T16 | Export single **PNG** (transparent BG if used) | Dims = source; alpha OK; RGB intact | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T17 | Export single **JPEG** | Opaque composite; dims match; expected BG | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T18 | Download **ZIP** (all + masked-only) | Expected files; scopes correct | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T19 | Compare canvas preview vs export | No unexpected crop/alpha flip | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T20 | Load many large photos / background apps | Named fail or success; Retry works; no silent tab death | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T21 | Background browser mid-batch | Resume or clear failure; counters not corrupted | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T22 | **Clear all** mid-batch | In-flight abandoned; no zombie progress | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T23 | Clear site data/cache; cold open; time to model ready | Download % UI; record wall time + ~MB | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T24 | Reload tab; warm 8-image batch | No full re-download (or note miss); record batch time | NOT RUN | NOT RUN | NOT RUN | NOT RUN | |
| T25 | HEIC from Camera Roll if picker offers it | Reject + guidance **or** Safari decode — document actual | NOT RUN | NOT RUN | N/A | NOT RUN | |

---

## Cold vs warm recording table

| Metric | iOS cold | iOS warm | Android cold | Android warm | Desktop cold | Desktop warm |
| --- | --- | --- | --- | --- | --- | --- |
| Model download wall (s) | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Approx MB (UI / Network) | NOT RUN | — | NOT RUN | — | NOT RUN | — |
| Time to first ready | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| 8-image batch after ready | — | NOT RUN | — | NOT RUN | — | NOT RUN |
| Device (webgpu/wasm) if shown | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

**Emulation reference only (not a physical PASS):** cold ~155 s / ~88 MB fp16; warm 4-image ~10 s @ 390×844.

---

## Cancellation / retry / edit / export focus (must stay NOT RUN until devices)

| Focus area | Covered by | Physical status |
| --- | --- | --- |
| Batch + pending gate (≥8 images) | T01–T04 | NOT RUN |
| Retries + errors | T05–T06 | NOT RUN |
| Cancellation + recovery | T21–T22 | NOT RUN |
| Mask editing (brush / polygon) | T12–T13 | NOT RUN |
| Undo/redo + isolation | T14–T15 | NOT RUN |
| PNG / JPEG / ZIP | T16–T18 | NOT RUN |
| Preview/export parity | T19 | NOT RUN |
| Cold / warm model load | T23–T24 | NOT RUN |
| Screenshots / reproducible evidence | Session record + Evidence column | NOT RUN |

---

## Sign-off

| Role | Name | Date | Decision |
| --- | --- | --- | --- |
| Tester (iOS) | | | COMPLETE / INCOMPLETE |
| Tester (Android) | | | COMPLETE / INCOMPLETE |
| Product | | | Accept residual risk? Y/N |
| Engineering | | | Update `FINAL_PRODUCTION_READINESS_REPORT.md` mobile section |

**Until critical rows (T01–T06, T12–T19, T23–T24) are PASS on both physical devices, do not claim “mobile production ready.”**
