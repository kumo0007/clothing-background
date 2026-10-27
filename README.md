# Garment Background Studio

Garment photo tool built with React, TypeScript, and the HTML Canvas API. Mask editing, compositing, and export run in the browser.

**Auto-mask** uses **BiRefNet_lite 512** (`studioludens/birefnet-lite-512`, ONNX FP16) via **onnxruntime-web WASM** in the browser. Images are **not** uploaded to Poof, remove.bg, or any hosted inference API. There is **no** automatic fallback to RMBG, ISNet, Lab-seed, or other engines — load/inference failures surface as clear errors.

## Model

| Item | Value |
|------|--------|
| Checkpoint | `public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx` |
| Size / SHA-256 | 98 484 532 bytes / `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516` |
| Code / weights license | MIT (studioludens export; upstream ZhengPeng7/BiRefNet) |
| Training-data note | DIS5K (and related sets) may have separate terms — **review before commercial catalog use**; do not treat MIT model code as legal clearance for all training data. |
| Adapter | `src/lib/mask/birefNet/` |
| Session | Shared lazy ONNX session; WASM default (WebGPU opt-in only via `VITE_BIREFNET_WEBGPU=1` and only after validity checks) |
| Fetch | `npm run fetch:birefnet-weights` |

## Auto-mask flow

1. Upload images.
2. Batch → **Auto-mask all** (first run loads ~94 MB BiRefNet FP16 from same-origin `/models/…`).
3. BiRefNet returns logits → sigmoid → soft alpha `MaskPixelBuffer` (255 KEEP / 0 BG / soft gray).
4. Compositing uses **original upload RGB** × mask + replacement background.
5. Edit Mask (brush/polygon/undo) if Review is flagged, then Adjust / ZIP export.

Classical Lab-seed / ISNet / contour / RMBG adapters may remain in-repo for scripts and audits but are **not** wired into the Batch UI auto-mask path.

## Scripts

```bash
npm install
npm run fetch:birefnet-weights   # required before first auto-mask / build
npm run validate:birefnet-weights
npm run verify:birefnet-browser  # Chromium dual EP smoke (WASM required)
npm run dev
npm run typecheck
npm test
npm run build
npm run verify:release
```

## Test packs

- `public/testdata/clothing/` — clothing JPEG fixtures.
- `scripts/benchmarkBirefNet.mts` — BiRefNet quality harness.
- `tmp-model-eval/` — diagnosis / polo-carpet validation artifacts.
