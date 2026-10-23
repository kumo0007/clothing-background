# Lab-seed vs Local ISNet — Evidence Report

Generated: 2026-10-23

## Verdict

**Not production-ready** for fully automatic hard cases (especially white sneakers / white tee).

ISNet ONNX (`@imgly/background-removal-node`, genuine inference) **improves** some dark/chromatic products and **handbag open handles**, but **does not solve white-on-near-white** and **regresses** coat / sneakers definite-label IoU vs Lab-seed. **Default remains Lab-seed.** ISNet is wired as an **opt-in** path (`method: 'isnet'`) that fails loudly — it never silently substitutes Lab-seed.

## 1. Candidates considered

| Candidate | Local? | Fit for flat-lay products | License | Notes |
| --- | --- | --- | --- | --- |
| **ISNet via @imgly/background-removal*** | Yes (ONNX) | General salient FG — good prior | **AGPL-3.0** (commercial may need IMG.LY paid license) | Evaluated (Node package = same model family as browser) |
| OpenCV.js GrabCut | Yes (WASM) | Seeded graph-cut | Apache-2.0 (OpenCV) | **Not reliable in this repo’s Node/Vite path** — hangs / skipped; Lab-seed labeled `opencv-seed-fallback` |
| MediaPipe Image Segmenter | Yes | Selfie/person-centric | Apache-2.0 | Poor fit for product flat-lays |
| SegFormer clothes (Transformers.js) | Yes | Worn-clothes parsing on people | Model-dependent | Wrong task for isolated sneakers/bags |
| BRIA RMBG-1.4 | Yes | Strong matting | **Non-commercial** without BRIA deal | Not adopted for commercial product path |

## 2. What actually ran (no silent confusion)

| Path | `methodUsed` | `genuineModelInference` |
| --- | --- | --- |
| Current default | `opencv-seed-fallback` | **false** (Lab-seed; GrabCut not executed) |
| Opt-in ISNet | `isnet-onnx` | **true** |

GrabCut was **not** claimed. First ISNet call downloads ONNX weights from IMG.LY CDN (~tens of MB); subsequent runs use cache.

## 3. Measured results (definite-label IoU)

Reference = appearance+border derived (uncertain excluded). **Not manual GT.**

| Fixture | Lab IoU | ISNet IoU | Δ IoU | Visual note |
| --- | ---: | ---: | ---: | --- |
| 01_hoodie | 0.843 | 0.831 | -0.012 | Similar |
| 02_blazer | 0.815 | **0.965** | **+0.150** | ISNet cleaner |
| 03_tshirt | 0.029 | 0.035 | +0.006 | Both fail white-on-white; ISNet leaves card corners |
| 04_jeans | 0.757 | **0.914** | **+0.158** | ISNet cleaner |
| 05_coat | **0.947** | 0.805 | -0.142 | Lab better (ISNet under-keeps) |
| 06_sweater | **0.895** | 0.880 | -0.014 | Similar; residual fringe |
| 07_dress | **0.882** | 0.870 | -0.012 | Thin straps still fragile |
| 08_sneakers | **0.338** | 0.204 | -0.134 | **Both unacceptable**; leather holes remain |
| 09_handbag | 0.938 | **0.953** | +0.015 | ISNet clears handle holes (**34 → 0** proxy) |
| 10_cap | **0.890** | 0.836 | -0.054 | Lab better on brim |

### Latency (this machine, Node)

- Lab-seed: ~0.4–1.1 s / image  
- ISNet medium: ~2.3–3.0 s / image (after model warm)

### Source RGB

`sourceRgbUnchanged: true` on all Lab and ISNet runs — mask controls composite only.

## 4. Visual QA (required hard cases)

Exports under `tmp-model-compare/{lab-seed,isnet}/{source,masks,magenta,beige,transparent}/`.

| Case | Lab-seed | ISNet |
| --- | --- | --- |
| White sneakers | Severe leather loss | Still severe leather loss + lace cuts |
| White T-shirt | Contaminated / ambiguous | Body partly kept; **bottom card corners retained** |
| Handbag handles | Residual studio in arches (holes~34) | **Arches mostly clear** (holes~0); thin halo remains |
| Thin dress straps | Fragile | Fragile |
| Silhouette halos | Present on dark knits | Present; often thinner, sometimes under-recall |

## 5. Files changed

| File | Role |
| --- | --- |
| `src/lib/mask/model/isnetSegment.ts` | Node/browser ISNet mask extraction |
| `src/lib/mask/autoMaskPipeline.ts` | `method: 'isnet'` + light footer/open-arch cleanup only |
| `src/types/imgly-background-removal.d.ts` | Ambient types |
| `scripts/compareLabVsIsnet.mts` | Side-by-side eval harness |
| `scripts/smokeIsnet.mts` | Smoke genuine inference |
| `src/lib/mask/model/isnetSegment.test.ts` | Default path must not silently become ISNet |
| `package.json` | `@imgly/background-removal-node` dependency |

**Not changed as primary “fix”:** global Lab thresholds / more fixture heuristics.

## 6. Runtime & license (recommended package)

- **Package:** `@imgly/background-removal-node` (eval) / `@imgly/background-removal` (browser, install when shipping UI path)  
- **Model:** ISNet family (`small` ~40MB quantized / `medium` ~80MB)  
- **Runtime:** `onnxruntime-node` (Node) / `onnxruntime-web` (browser)  
- **License:** **AGPL-3.0** — free for AGPL-compatible use; **commercial closed-source SaaS likely needs IMG.LY commercial license**. Confirm with counsel before production.  
- **Privacy:** Local inference; first download of weights from IMG.LY CDN (or self-host via `publicPath`).

## 7. Recommendation

1. **Keep Lab-seed as default** for batch (fast, no AGPL, no multi-second model download).  
2. **Offer ISNet as opt-in** for catalog shots that are dark/chromatic or have open handles — where metrics/visuals improve.  
3. **Do not claim** ISNet fixes white sneakers / white tee.  
4. **GrabCut:** remain opt-in only; do not re-enable as default (UI hang risk).  
5. Next research (out of scope here): commercially licensed general matting (e.g. BRIA with paid terms) or a product-specific fine-tune — not more Lab threshold knobs.

## 8. Tests / typecheck / build

Run after this report generation; see agent summary.

## 9. Remaining failures (manual correction)

- White sneakers / white tee on near-white card  
- Residual handle/strap AA halos (even when openings clear)  
- Coat under-recall under ISNet  
- Thin straps  
- Cluttered non-studio backgrounds (fixtures 11–20 not in this metric table)
