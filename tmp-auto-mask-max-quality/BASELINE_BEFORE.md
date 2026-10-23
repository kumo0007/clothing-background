# Baseline before max-quality pass

Copied from `tmp-final-quality-pass` (2026-10-23T03:58:46Z).

| Fixture | IoU | fgRecall | fgPrecision | Concern |
| --- | ---: | ---: | ---: | --- |
| 05_coat | 0.947 | 0.993 | 0.954 | Strong |
| 06_sweater | 0.894 | 0.900 | 0.992 | Residual fringe |
| 07_dress | 0.888 | 0.913 | 0.970 | Thin straps |
| 08_sneakers | 0.339 | 0.826 | 0.365 | White leather loss |
| 09_handbag | 0.939 | 0.953 | 0.985 | Handle/strap AA |
| 10_cap | 0.897 | 0.914 | 0.980 | Soft brim halo |

Client ZIP (`garment-results-all.zip`) = prior opaque beige exports — α=255 corners intentional.

Sneaker stage pathology (prior probes): seeds pale~57k → stripEnclosed~15k → final~9k. Lab cannot separate flat leather from card by color alone; geodesic pale protect from dark soles is too local; unrestricted reclaim floods cap card.
