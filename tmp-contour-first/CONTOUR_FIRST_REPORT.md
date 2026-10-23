# Contour-First Segmentation — Evaluation Report

Generated: 2026-10-23

## Verdict

**Not safe to enable as default.** Contour-first is wired as an **explicit opt-in** (`runAutoMaskPipeline(img, 'contour')` / `methodUsed: 'contour-first'`). Lab-seed remains the default. ISNet remains a separate opt-in.

White T-shirt and white sneakers are **not** solved. On several chromatic fixtures (dress, sweater, handbag, cap) contour-first **regresses** vs Lab-seed by filling studio-card regions when edge barriers fail to form a tight silhouette.

## 1. Root causes (confirmed failures)

| Case | Root cause / limiting stage |
| --- | --- |
| White tee (~59–62% near-white remnant) | **Stage A/B**: silhouette gradients vs card are weak; barrier flood either leaks or accepts a card-sized “interior.” Lab seed prior is also wrong (definite FG ≈ 380 px). Color-blind fill cannot invent a missing edge. |
| White sneakers (worse near-white / IoU) | **Stage B + E**: barriers under-segment leather; skipping pale studio peels (required to keep tee interiors) leaves card residue; IoU drops vs Lab. |
| Dress / cap / sweater regressions | **Stage B**: incomplete barriers → exterior flood stops early → oversized interior validated; seed agreement can still look “ok” while card is enclosed. |
| Hoodie / coat | Contour **rejected** (`rejects-seed-garment-mass`) → honest seed fallback + `needsReview`. |
| Blazer / jeans | Contour accepted; near-white remnant similar or slightly better than Lab; not a reason to switch default. |
| Angular card slabs (prior bug) | Already fixed in Lab path (soft-alpha strip + exterior peel); contour-first must not reintroduce them when falling back. |

Compositing polarity unchanged: `255` keep / `0` remove / gray alpha; source RGB never mutated; preview/export share the same mask buffer.

## 2. Algorithm (stages A–E)

Implemented in `src/lib/mask/contourFirst/contourFirstSegment.ts`:

1. **A – Edges**: scale-normalized Sobel magnitude on luma.
2. **B – Barriers + exterior flood**: strong edges (+ seed-silhouette assist) are walls; flood from image borders through non-barrier pixels; unflooded region = candidate garment.
3. **C – Gap close**: scale-aware morphological close on barriers; large completion → `substantialCompletion` → `needsReview`.
4. **D – Validate**: reject full-frame, border-following card, sparse leak rings, under-overlap vs seed mass, over-fill vs seed area.
5. **E – Fill + refine**: rasterize KEEP interior; open-arch / detached islands; **no** `peelExteriorStudioKeep` when contour accepted (would erase white garments); `refineBoundaryAlpha` + light feather.

Lab-seed is **supporting evidence only**. On reject → seed fallback + `needsReview` (never silent ISNet swap).

## 3. Files changed

| File | Role |
| --- | --- |
| `src/lib/mask/contourFirst/contourFirstSegment.ts` | Contour-first pipeline |
| `src/lib/mask/contourFirst/contourFirstSegment.test.ts` | Edge/flood/fill/white-on-white/integration tests |
| `src/lib/mask/autoMaskPipeline.ts` | `method: 'contour'` opt-in API + diagnostics |
| `scripts/compareContourFirst.mts` | Lab vs contour side-by-side exports |
| `tmp-contour-first/` | Diagnostics + this report |

## 4. Diagnostics

Side-by-side under `tmp-contour-first/{lab-seed,contour-first}/{source,edges,masks,magenta,beige}/` and `summary.json`.

## 5. Per-fixture comparison (Lab default vs Contour-first)

| Fixture | Lab IoU | CF IoU | Lab near-white% | CF near-white% | CF accepted? | Winner |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| hoodie | 0.989 | 0.757 | 0.26 | 0.07 | no (fallback) | Lab (quality) |
| blazer | 0.985 | 0.986 | 0.26 | 0.10 | yes | ~tie / CF slightly cleaner |
| **tshirt** | 0.031 | 0.026 | **62.2** | **59.3** | yes | **neither** |
| jeans | 0.941 | 0.945 | 0.30 | 0.04 | yes | ~tie |
| coat | 0.959 | 0.945 | 0.01 | 0.00 | no (fallback) | Lab |
| sweater | 0.894 | 0.761 | 0.19 | **9.5** | yes | **Lab** |
| dress | 0.906 | 0.230 | 0.09 | **61.3** | yes | **Lab** |
| **sneakers** | 0.453 | 0.129 | 6.2 | **18.8** | yes | **Lab** |
| handbag | 0.946 | 0.701 | 0.61 | **14.3** | yes | **Lab** |
| cap | 0.908 | 0.577 | 0.18 | **18.8** | yes | **Lab** |

## 6. Tests / typecheck / build

- **159** tests passed (23 files)
- **typecheck** passed
- **build** passed

## 7. Remaining limitations

- White-on-white still needs **Polygon Select** (add/subtract) when edges are insufficient.
- Contour-first over-accepts when barriers enclose studio; over-fill / seed checks reduce but do not eliminate dress/cap/sweater failures.
- OpenCV Canny/WASM intentionally unused here (UI hang risk); pure JS Sobel barriers.
- Passing tests ≠ visual acceptance.

## 8. Default recommendation

**Keep Lab-seed as default.** Ship contour-first as **opt-in only** for experimentation / diagnostics (`'contour'`). Do not auto-switch. Revisit default only after white tee/sneaker near-white remnant and IoU clearly beat Lab without regressing dress/handbag/cap.
