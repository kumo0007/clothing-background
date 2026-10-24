# Garment Background Studio

Garment photo tool built with React, TypeScript, and the HTML Canvas API. Mask editing, compositing, and export run in the browser.

**Auto-mask** uses [`bg-remove-sdk`](https://www.npmjs.com/package/bg-remove-sdk) (`createBgRemover`) with **RMBG-1.4** via transformers.js in a **Web Worker** (WebGPU when available, WASM fallback). Images are **not** uploaded to Poof, remove.bg, or any hosted inference API. No API key is required for inference.

## Commercial licensing (important)

| Component | License |
|-----------|---------|
| `bg-remove-sdk` package | MIT |
| Default model `briaai/RMBG-1.4` | **Creative Commons for non-commercial use**; commercial use requires a [BRIA commercial agreement](https://huggingface.co/briaai/RMBG-1.4) |

Do **not** treat this integration as production-ready for commercial catalogs until a BRIA commercial license is obtained (or the model is replaced with a commercially licensed alternative / self-hosted weights you are licensed to use).

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

Classical Lab-seed code remains in-repo for audits/scripts (`labSeedAutoMask.ts`) but is **not** the Batch UI default.

## Scripts

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

## Test packs

- `public/testdata/clothing/` — clothing JPEG fixtures.
- `scripts/auditLocalAutoMask.mts` — classical Lab-seed smoke (no GPU).
- Live RMBG quality requires a real browser (WebGPU/WASM + model download).
