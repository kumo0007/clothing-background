# Strategy wiring investigation

Date: 2026-10-23  
Artifacts: `tmp-strategy-wiring/` (`masks/`, `diff/`, `beige/`, `stages/`, `WIRING_REPORT.json`)  
Script: `scripts/investigateStrategyWiring.mts`

## Root cause of unchanged exports

**The UI batch path never requested contour-first or ISNet.**

| Stage | Evidence |
| --- | --- |
| Upload | Image IDs + object URLs in `App` state |
| Auto-mask button | `App.handleAutoMaskAll` → `autoMaskCornersForImage(id, url, w, h)` **with no `method` argument** |
| Default | `method: AutoMaskMethod = 'auto'` → Lab-seed (`opencv-seed-fallback`) |
| Contour / ISNet | Exist in `runAutoMaskPipeline` but were unreachable from Batch UI |
| Commit | `setMask(imageId, result.mask)` — correct when a strategy runs |
| Preview | `CanvasPreview` → `getMask(image.id)` — same store |
| Export PNG/JPEG/ZIP | `renderProjectCanvas` / `exportZip` → `getMask` — same store |

Changing contour-first in source **cannot** change ZIP exports while the button only runs Lab-seed. This is not stale cache and not identical algorithms — the alternate strategies were simply never invoked from the product surface.

Headless proof: when `requested=contour`, `methodUsed=contour-first` on every fixture below, checksums differ from Lab, and Lab-vs-contour disagreement images are non-empty.

## Execution path (one image)

```
upload → UploadedImage { id, objectUrl, width, height }
      → Batch "Auto-mask all"
      → autoMaskCornersForImage(id, url, w, h, 40, strategy)
      → loadHtmlImage + getImageData
      → runAutoMaskPipeline(imageData, strategy, 40)
      → setMask(id, result.mask)   // committed
      → maskMeta.revision++
      → CanvasPreview getMask(id)  // preview
      → buildResultsZip → renderProjectCanvas → getMask(id)  // export
```

Background / adjustments only mutate `projects[id].background` / `.adjustments` — they do **not** regenerate masks.

## Strategy proof (fixtures)

UI batch default on every fixture: `requested=auto`, `methodUsed=opencv-seed-fallback`, checksum matches the Lab column.

| Fixture | Lab checksum | Contour checksum | Disagree px | Disagree % | Store↔export parity |
| --- | --- | --- | --- | --- | --- |
| 01_hoodie | `4900de503a208188` | `656e58aad48504bb` | 12831 | 14.7% | true |
| 02_blazer | `fd9f116cc39ea807` | `314632af5f1f7003` | 1779 | 2.1% | true |
| 03_tshirt | `091460c5b33da35a` | `965cb9d8aaf6589a` | 2945 | 3.4% | true |
| 04_jeans | `60bb62d92b3f52cd` | `0e9d24b2b4dab4b5` | 1649 | 1.9% | true |
| 08_sneakers | `5ce7827e05a62f41` | `29e7dc3ef9ddc71a` | 16741 | 19.6% | true |
| 09_handbag | `cdfc41de331ecb3f` | `1013da31f8f3585a` | 13597 | 15.9% | true |

- No silent Lab substitution when contour is requested (`methodUsed` stayed `contour-first`).
- Source RGB unchanged for every run.
- Diff images: `tmp-strategy-wiring/diff/*-lab-vs-contour.png` (red = Lab KEEP / contour REMOVE; cyan = opposite).
- Raw masks: `tmp-strategy-wiring/masks/`.
- Beige composites: `tmp-strategy-wiring/beige/`.

ISNet was not batch-run here (opt-in + model download). Pipeline still routes `method:'isnet'` only when requested; it does not silently fall back to Lab (throws / reports genuine inference).

## Preview / export consistency

Confirmed:

1. Strategy produces a new mask (checksum changes vs empty / vs other strategy).
2. `setMask` commits under the correct image ID.
3. Preview and export both read `getMask(id)` — byte-identical composites in the investigation script.
4. Background state changes do not overwrite `maskStore`.
5. Per-image isolation holds (masking A does not alter B).

## Contour-first white-on-white: first failing stage

### 03_tshirt

**First fail: `B-exterior-flood` — interior too large (57.4% of frame).**

| Stage | Finding |
| --- | --- |
| A-edges | Strong edges exist (density 0.21) — garment edge is partially detected |
| A-barriers | 8533 barrier px @ thr 38 |
| C-gap-close | Gap closed, not substantial |
| **B-flood** | Interior **49 271 px (57%)** — barrier follows studio card / misses tight garment edge |
| D-validate | **Incorrectly accepts** (seedAgreement 0.88, areaRatio 0.57 < 0.92 cap) |
| E-fill / final | Contour accepted; final fg 49374 vs Lab 52529 |

Bottleneck: edge barrier does not isolate the tee from the card; validation area cap (0.92) is too loose for card-sized interiors.

### 08_sneakers

**First fail: `C-gap-close:substantial + D-validate:accepted-weak-seedAgreement` (seedAgreement 0.44).**

| Stage | Finding |
| --- | --- |
| A-edges | Density 0.21 |
| A-barriers | 13686 → after C: **16501** (substantial gap close) |
| B-flood | Interior 32% — size OK |
| D-validate | Accepts with **seedAgreement 0.44** |
| E-fill | **44 294** fg (seed ≥240 merge adds ~17k outside contour) |
| open-arch / islands | Final **14 500** fg — drops ~67% of E-fill |
| vs Lab | Lab 7848 fg; contour keeps ~2× (likely extra studio) |

Bottleneck: substantial gap closing joins unrelated edges → weak silhouette still validated → fill merges seed structure → open-arch cleanup fights the bloated fill (not a safe garment edge).

## Bugs fixed in this pass

1. **UI never requested non-default strategies** → Batch panel strategy selector (default Lab-seed; contour / ISNet opt-in). `handleAutoMaskAll` passes the selected method and reports `methodUsed` in progress text.
2. **Contour seed fallback still labeled `methodUsed: 'contour-first'`** → now `'contour-first-fallback-seed'` when `contourAccepted` is false.
3. **`autoMaskCornersForImage` return** → exposes `requestedMethod`, `methodUsed`, `genuineModelInference` for honest logging.
4. **Regressions** → `src/lib/batch/strategyWiring.regression.test.ts` (+ contour fallback label test).

## What was *not* changed

- Default strategy remains Lab-seed (`auto` / `opencv-seed-fallback`).
- No new segmentation algorithm; no fixture hard-coding; no silent Lab swap for ISNet.
- Polygon editing, mask history, batch, source RGB, transforms, exports preserved.

## Segmentation bottleneck (summary)

Wiring was the reason **exports looked unchanged**. Once strategies actually run, masks **do** differ (up to ~20% pixel disagreement). Contour quality on white-on-white is a separate bottleneck (tee: oversized interior after flood; sneakers: substantial gap-close + weak validation + open-arch wipe) — not export caching.
