# BiRefNet-only — final independent verification

**Date:** 2026-10-27 / 2026-10-28  
**Basis:** Source inspection + Chromium harness + multi-fixture WASM path + gates  
**Code changes in this verify pass:** comment-only (`strategyWiring.regression.test.ts`); no model/threshold edits.

## Verdict

**Production Batch/UI automatic segmentation is BiRefNet-only (WASM).** No silent RMBG / Lab-seed / ISNet / contour / GrabCut fallback on that path. Browser WASM inference works; WebGPU remains unusable on this host. Manual edit + export preserved. **Do not claim perfect segmentation or commercial license clearance.**

---

## 1. Production call graph (verified)

```
Upload (App)
  → Batch Auto-mask
    → autoMaskCornersForImage
      → dynamic import('../mask/birefNet').segmentWithBirefNet
        → preloadBirefNetModel (shared session, WASM default)
        → preprocess → runBirefNetInference → logitsToMaskBuffer
        → reviewSdkMask (diagnostics only)
        → setMask(imageId, mask)   // RGB source untouched
  → CanvasPreview / MaskEditor / exportZip
```

| Check | Result |
| --- | --- |
| `App.tsx` imports for auto-mask | `autoMaskCorners` + `birefNet` preload only |
| `autoMaskCorners.ts` | No `segmentWithBgRemoveSdk`, no `fallbackFrom` |
| Init failure | Marks queue failed + error UI; does not continue with another model |
| `repairSdkUnderRecall` on BiRefNet | **Not applied** in `segment.ts` |
| Components | No auto-segment imports of competing engines |

**EP-only “fallback”:** If `VITE_BIREFNET_WEBGPU=1` and WebGPU logits are degenerate, session rebuilds as **WASM BiRefNet** — not another model. Default production does not prefer WebGPU.

---

## 2. Bundle / deps / network (production vs scripts)

| Layer | Finding |
| --- | --- |
| `dist/assets/` | `birefNet-*.js`, `ort.bundle*`, wasm — **no** `bgRemoveSdk` chunk |
| `package.json` build | `fetchBirefNetBrowserWeights` only (no RMBG fetch / worker emit) |
| Service worker | None in `src/` |
| Runtime model fetch | Same-origin `/models/studioludens/birefnet-lite-512/…` |
| `bg-remove-sdk` / `@imgly/*` in package.json | Still installed for **scripts/tests**; **not** wired into App Batch path |
| Lab / ISNet / contour / OpenCV | Exist under `src/lib/mask/` for scripts/audits; **not** imported by `App.tsx` auto-mask |

---

## 3. Checkpoint

| Field | Observed |
| --- | --- |
| Path | `public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx` |
| Bytes / SHA-256 | 98 484 532 / `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516` |
| I/O | `input_image` → `output_image` `[1,1,512,512]` |
| `validate:birefnet-weights` | `allOk: true` |
| License note | MIT export; **DIS5K training-data commercial review still open** |

Preprocess/polarity (unchanged, reconfirmed): ImageNet NCHW 512, sigmoid → soft α → **255 KEEP / 0 BG**.

---

## 4. Browser (Chromium Playwright) — sneakers fixture

Artifact: `tmp-model-eval/birefnet-browser-verify/`

| EP | Session | KEEP | Degenerate | Cold / warm | Method id |
| --- | --- | ---: | --- | --- | --- |
| **WASM** | ok | **0.345** | no | 13.1s / 11.2s / 10.3s | `birefnet-lite-512` |
| **WebGPU** | creates | **0** | **yes** | 8.9s / 7.4s / 4.8s | same id; `computeSliceOffsets` validation errors |

- `notSilentRmbg: true` on both  
- WASM polarity center≫border — correct  
- Production must keep **WASM** (confirmed)

---

## 5. Representative fixtures (production BiRefNet path, Node WASM)

Artifact: `tmp-model-eval/birefnet-sole-final-verify-2026-10-27/`

| ID | Case | KEEP% | Infer ms | Dims=src | Garment RGB intact | Notes (observed) |
| --- | ---: | ---: | ---: | --- | --- | --- |
| dark-hoodie | dark garment | 55.43 | 11198 | yes | **yes** | Clean silhouette on black |
| white-tshirt | white on light | 49.04 | 10472 | yes | **yes** | Hard case; soft edges expected |
| white-sneakers | sneakers | 34.50 | 10495 | yes | **yes** | Magenta composite clean |
| open-handbag | handles | 35.68 | 10714 | yes | **yes** | Handle holes present vs gray |
| polo-carpet-closeup | polo-5 collar | 73.89 | 10504 | yes | **yes** | Tags/string kept |

Also measured: `repairSdkUnderRecall` **would** fire on several of these if re-enabled — production correctly does **not**.

Composites: `composites/*-over-{white,black,gray,magenta}.png` · cutouts: `transparent/`.

---

## 6. Failure behavior (verified by tests + logic)

- BiRefNet throw → `autoMaskCorners` rejects (no alternate engine)  
- Preload fail → App marks all queued images failed + `upload-error`  
- Degenerate WebGPU → WASM BiRefNet retry (same model), then throw if still bad  

---

## 7. Gates (this verification run)

| Gate | Result |
| --- | --- |
| typecheck | pass |
| tests | **399** passed, 1 skipped |
| lint | pass (pre-existing warnings) |
| production build | pass (BiRefNet + ORT only in client chunks) |
| weight validate | `allOk: true` |
| Chromium verify | WASM pass / WebGPU quality fail (expected) |

---

## 8. Defects fixed in this pass

**None** requiring model/threshold changes. Only corrected an outdated test comment stating UI still used bg-remove-sdk.

Prior already-landed fixes still hold: sole BiRefNet auto path, no RMBG fallback, real `ImageData` overlays, WASM default.

---

## 9. Remaining limitations / release blockers

| Item | Severity | Notes |
| --- | --- | --- |
| DIS5K / training-data commercial review | **Release policy blocker** | Not a code defect; do not claim legal clearance |
| White-on-light / carpet close-ups | Product quality | May need manual brush; not “perfect” auto |
| Warm WASM ~10–11 s (browser) / ~7–11 s (Node) | UX | Session reused; still slow for large batches |
| WebGPU degenerate | Ops | Keep disabled; do not ship as default |
| Legacy npm packages (`bg-remove-sdk`, imgly) | Hygiene | Not in App Batch graph; optional future prune |
| Tape / props on product shots | Quality | May remain KEEP |

---

## 10. Reproduce

```bash
npm run validate:birefnet-weights
npx tsx scripts/verifyBirefNetSoleFinal.mts
npx tsx scripts/verifyBirefNetBrowser.mts   # needs build + Chromium
npm run typecheck && npm test && npm run lint && npm run build
npm run dev
```
