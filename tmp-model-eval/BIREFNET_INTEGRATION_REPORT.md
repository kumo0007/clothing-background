# BiRefNet integration report

**Date:** 2026-10-27  
**Status:** Integrated as **default** on-device auto-mask backend with explicit RMBG-1.4 fallback. Fixture quality side-by-side against Lab-seed / live RMBG was **not** re-run in this session (Hugging Face download of the ~94 MB ONNX was blocked by `ENOTFOUND` / `ECONNRESET`).

---

## Checkpoint and runtime

| Field | Value |
| --- | --- |
| Upstream | [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet) (`BiRefNet_lite`) |
| Browser ONNX mirror | `studioludens/birefnet-lite-512` |
| Artifact | `public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx` (~94 MB fp16) |
| Method id | `birefnet-lite-512` |
| Provider | `birefnet-onnx` |
| Runtime | **Browser** `onnxruntime-web` — WebGPU preferred, WASM fallback |
| Input | 512×512 RGB, ImageNet mean/std, NCHW float32 |
| Output | Soft logits → sigmoid → bilinear resize to source size; `255=KEEP` |

Fetch: `npm run fetch:birefnet-weights` (also invoked during `npm run build`; soft-warns if HF unreachable).

---

## License / commercial

| Layer | License | Notes |
| --- | --- | --- |
| Code / BiRefNet_lite weights (declared) | **MIT** | Allowed to redistribute MIT weights |
| Training data (DIS5K) | Separate dataset ToU | Commercial products should still review DIS5K terms with counsel |
| RMBG-1.4 fallback | BRIA non-commercial/eval unless licensed | Unchanged SDK path |

This does **not** constitute legal approval for commercial shipping.

---

## How to select in the app

1. Upload images.
2. In **Batch → Masking model**, choose **BiRefNet (default)** or **RMBG-1.4 (fallback)**.
3. Tap **Start Auto-mask all**.
4. Status / mask meta reports the **actual** method used (`birefnet-lite-512` or `bg-remove-sdk-rmbg1.4`). Fallback reasons are recorded when BiRefNet fails.

Inference is entirely **in the browser** (no per-image paid API).

---

## Fallback behavior

1. Capture diagnostic / error message.
2. Drop failed BiRefNet session state as needed.
3. Per image: try BiRefNet → on failure run RMBG-1.4 via `bg-remove-sdk`.
4. Record `fallbackFrom` / `fallbackReason` and force `needsReview` when fallback ran.
5. Preserve original RGB; never return an empty KEEP mask as success.

If RMBG is selected and its init fails, the whole queue is marked failed (no silent empty masks).

---

## Verification run (this session)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | **392** tests passed (62 files) |
| `npm run lint` | Pass (pre-existing warnings only) |
| `npm run fetch:birefnet-weights` | **Incomplete** — HF DNS/network failure; partial ONNX removed |
| `npm run build` | Pending after soft-fetch fix |
| Real-model latency / peak memory | **Not measured** (weights unavailable on this network) |
| Fixture quality vs Lab-seed / ISNet / RMBG | **Not measured** this session — do not claim BiRefNet superiority without re-running fixtures after a successful weight mirror |

---

## Known limitations

- First load downloads ~94 MB same-origin ONNX (keep tab open on Wi‑Fi).
- Safari / low-RAM devices may prefer WASM and be slower; OOM still possible on very large batches.
- Without mirrored weights, default BiRefNet path fails open into RMBG-1.4 with an explicit status line.
- Soft edges / under-recall repair reuse the existing SDK repair helpers; genuine handle holes are not auto-filled.
