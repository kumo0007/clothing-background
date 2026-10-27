# BiRefNet quality & performance diagnosis

Generated: 2026-10-27T02:44:24.482Z

## Contract

```json
{
  "checkpoint": {
    "mean": [
      0.485,
      0.456,
      0.406
    ],
    "std": [
      0.229,
      0.224,
      0.225
    ],
    "rescale_factor": 0.00392156862745098,
    "resample": 2,
    "resampleMeaning": "PIL.BILINEAR",
    "size": {
      "height": 512,
      "width": 512
    },
    "do_normalize": true,
    "do_rescale": true,
    "do_resize": true
  },
  "appConstants": {
    "mean": [
      0.485,
      0.456,
      0.406
    ],
    "std": [
      0.229,
      0.224,
      0.225
    ],
    "size": 512,
    "rescale": "pixel/255",
    "resize": "bilinear half-pixel",
    "layout": "NCHW float32 RGB",
    "output": "sigmoid(logits) → soft alpha → bilinear upscale → 8-bit KEEP=255"
  },
  "match": {
    "meanMatch": true,
    "stdMatch": true,
    "rescaleOk": true,
    "sizeMatch": true,
    "bilinearResample": true,
    "referenceRequiresSigmoid": true,
    "referenceDoc": "studioludens/birefnet-lite-512 README: Apply sigmoid externally to logits"
  },
  "verifiedCorrect": true
}
```

## Performance (sneakers)

| Config | Init ms | First infer | Mean warm infer | Prep | Post | Repair |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| wasm-default | 9718 | 7408 | 7091 | 20 | 10 | 46 |
| wasm-numThreads-1 | 8750 | 6916 | 6906 | 23 | 13 | 48 |

## Raw vs under-recall repair

| Fixture | Raw IoU† | Repaired IoU† | ΔIoU | Δkeep-binary % | Repair? | Assessment |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| 01_hoodie.jpg | 0.906 | 0.851 | -0.0556 | 4.958 | true | under-recall repair changed mask — inspect visuals |
| 03_tshirt.jpg | 0.050 | 0.030 | -0.0196 | 4.267 | true | under-recall repair changed mask — inspect visuals |
| 06_sweater.jpg | 0.876 | 0.842 | -0.0346 | 5.001 | true | under-recall repair changed mask — inspect visuals |
| 08_sneakers.jpg | 0.213 | 0.198 | -0.0156 | 4.486 | true | under-recall repair changed mask — inspect visuals |
| 09_handbag.jpg | 0.951 | 0.873 | -0.0776 | 11.331 | true | under-recall repair changed mask — inspect visuals |
| 10_cap.jpg | 0.847 | 0.799 | -0.0483 | 3.256 | true | under-recall repair changed mask — inspect visuals |

† Heuristic reference — not GT.

## Conclusion

Pre/post match checkpoint README + preprocessor_config; remaining IoU gap vs Lab-seed is primarily model/metric limitation, not inverted polarity or missing sigmoid.

**Confirmed cleanup defect:** `repairSdkUnderRecall` lowered IoU on every fixture above (ΔIoU −0.02…−0.08). Removed from BiRefNet `segmentWithBirefNet` only; see `tmp-model-eval/BIREFNET_DIAGNOSIS_2026-10-27.md`.

**WASM:** warm infer ~6.9–7.1 s dominates; `numThreads=1` without COI is safe and slightly faster here.

Confirmed WebGPU defect on this Chrome adapter: session creates but emits degenerate all-negative logits + computeSliceOffsets validation errors. Keep disabled for production.
