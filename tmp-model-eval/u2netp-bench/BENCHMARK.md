# U²-Netp clothing fixture benchmark

Generated: 2026-10-25T16:36:56.043Z

Weights: `tmp-model-eval/weights/u2netp.onnx` (4.36 MiB, Apache-2.0)
Session create: 456 ms · mean warm infer: 696 ms (Node WASM)

| Fixture | U² IoU | Lab IoU | Δ | keep% | soft% | comps | inferMs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 01_hoodie.jpg | 0.906 | 0.989 | -0.083 | 55.58 | 11.81 | 1 | 741 |
| 02_blazer.jpg | 0.968 | 0.985 | -0.017 | 56.12 | 5.35 | 1 | 687 |
| 03_tshirt.jpg | 0.056 | 0.031 | 0.026 | 49.23 | 8.15 | 1 | 723 |
| 04_jeans.jpg | 0.917 | 0.941 | -0.024 | 36.74 | 10.03 | 1 | 647 |
| 05_coat.jpg | 0.934 | 0.959 | -0.025 | 39.43 | 5.41 | 1 | 649 |
| 06_sweater.jpg | 0.880 | 0.894 | -0.014 | 47.14 | 5.83 | 1 | 770 |
| 07_dress.jpg | 0.873 | 0.906 | -0.033 | 19.21 | 4.89 | 1 | 689 |
| 08_sneakers.jpg | 0.215 | 0.453 | -0.238 | 34.64 | 10.11 | 1 | 691 |
| 09_handbag.jpg | 0.955 | 0.946 | 0.009 | 36.4 | 11.31 | 1 | 694 |
| 10_cap.jpg | 0.847 | 0.908 | -0.061 | 25.57 | 5.64 | 1 | 664 |

Reference = appearance+border definite labels (uncertain excluded). Not human GT.
Visual exports: `tmp-model-eval/u2netp-bench/{masks,transparent,beige,magenta}/`.
