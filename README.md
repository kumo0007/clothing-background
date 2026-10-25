# Garment Background Studio

Garment photo tool built with React, TypeScript, and the HTML Canvas API. Mask editing, compositing, and export run in the browser.

**Auto-mask** uses [`bg-remove-sdk`](https://www.npmjs.com/package/bg-remove-sdk) (`createBgRemover`) with **RMBG-1.4** via transformers.js in a **Web Worker** (WebGPU when available, WASM fallback). Images are **not** uploaded to Poof, remove.bg, or any hosted inference API. No API key is required for inference.

## Commercial licensing (important)

| Component | License | Notes |
|-----------|---------|-------|
| `bg-remove-sdk` package | **MIT** | Verified from package `LICENSE` |
| Default model `briaai/RMBG-1.4` | **`bria-rmbg-1.4`** (source-available, non-commercial) | HF model card ([briaai/RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4)): non-commercial / evaluation unless a [BRIA commercial agreement](https://go.bria.ai/3B4Asxv) is purchased. Prefer the HF card + files on the model repo as source of truth (the standalone `bria.ai/…license-agreement` URL returned **404** during the 2026-10-26 audit). Local/browser execution does **not** waive these terms. |

Do **not** treat this integration as production-ready for commercial catalogs until a BRIA commercial license is obtained (or the model is replaced with a commercially licensed alternative / self-hosted weights you are licensed to use). This is a **release blocker** for paid catalog workflows.

## Auto-mask flow

1. Upload images.
2. Batch → **Auto-mask all** (first run downloads ~88 MB fp16 weights into the browser Cache API).
3. SDK returns a transparent PNG; the app extracts **alpha only** into `MaskPixelBuffer` (255 KEEP / 0 BG / soft gray).
4. Compositing continues to use **original upload RGB** × mask + replacement background.
5. Edit Mask (brush/polygon/undo) if Review is flagged, then Adjust / ZIP export.

| Item | Value |
|------|--------|
| Adapter | `src/lib/mask/bgRemoveSdk.ts` |
| Shared instance | one `createBgRemover()` per page |
| Concurrency | 1 (SDK also serializes internally) |
| Network for images | none |
| Network for model | Hugging Face (or your mirror via `modelId`) on first load |
| Faster cold start | Set `VITE_BG_REMOVE_MODEL_ID` to a self-hosted HF-layout **RMBG-1.4** mirror (id/path must include `RMBG-1.4`; other model families are ignored). Upload also starts a **background preload** (one shared instance). |
| Release verify (technical) | `npm run verify:release` — typecheck + lint + tests + build + license status print (**does not** approve commercial use) |
| Commercial ship gate | `npm run verify:commercial-release` — fails while `BRIA_COMMERCIAL_LICENSE_CHECKLIST.md` is **UNRESOLVED** |

Classical Lab-seed code remains in-repo for audits/scripts (`labSeedAutoMask.ts`) but is **not** the Batch UI default.

Release-blocker notes (licensing, cold-start, device plan, tee/sneaker quality): `tmp-release-validation/RELEASE_BLOCKER_INVESTIGATION.md`.

## Scripts

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run verify:release              # technical gate (does not approve commercial use)
npm run verify:commercial-release   # fails while BRIA checklist is UNRESOLVED
```

## Test packs

- `public/testdata/clothing/` — clothing JPEG fixtures.
- `scripts/auditLocalAutoMask.mts` — classical Lab-seed smoke (no GPU).
- Live RMBG quality requires a real browser (WebGPU/WASM + model download).
