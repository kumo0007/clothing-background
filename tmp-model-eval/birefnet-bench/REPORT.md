# BiRefNet clothing benchmark

Generated: 2026-10-27T01:54:54.124Z

## Runtime

| Field | Value |
| --- | --- |
| Backend | `birefnet-lite-512` |
| Provider | onnxruntime-web **WASM** (Node harness) |
| Cold session | 10000 ms |
| Mean warm infer | 7080 ms |
| Weight SHA-256 | `eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516` |
| RMBG Node probe | loaded D:\project\public\models\briaai\RMBG-1.4\onnx\model_quantized.onnx inputs=input |

## Per-fixture (vs appearance+border reference — not pixel-perfect GT)

| Fixture | BiRef keep% | BiRef IoU | Lab IoU | BiRef ms | Flags |
| --- | ---: | ---: | ---: | ---: | --- |
| 01_hoodie.jpg | 55.43 | 0.906 | 0.989 | 7837 | — |
| 02_blazer.jpg | 55.84 | 0.965 | 0.985 | 7063 | — |
| 03_tshirt.jpg | 49.04 | 0.050 | 0.031 | 7319 | — |
| 04_jeans.jpg | 36.04 | 0.902 | 0.941 | 6701 | — |
| 05_coat.jpg | 39.25 | 0.932 | 0.959 | 7018 | — |
| 06_sweater.jpg | 46.95 | 0.876 | 0.894 | 6816 | — |
| 07_dress.jpg | 19.02 | 0.867 | 0.906 | 6848 | — |
| 08_sneakers.jpg | 34.5 | 0.213 | 0.453 | 7038 | — |
| 09_handbag.jpg | 35.68 | 0.951 | 0.946 | 7078 | — |
| 10_cap.jpg | 25.57 | 0.847 | 0.908 | 7083 | — |

## Interpretation

- Do **not** claim BiRefNet > Lab-seed / RMBG from this table alone without visual review of `magenta/` and `beige/`.
- White sneakers / white tee IoU is often unreliable when the reference marks FG/BG as uncertain.
- Handbag handle holes: inspect `transparent/09_handbag-cutout.png`.
- Browser WebGPU timing is **unmeasured** in this Node run; use `scripts/verifyBirefNetBrowser.mts` for Chromium.
