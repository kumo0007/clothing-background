# Production Pass Report — Garment Background Removal

Generated: 2026-10-23 (final targeted quality pass)

See also: `tmp-final-quality-pass/FINAL_TARGETED_PASS_REPORT.md`

## Verdict

**Not production-ready** for fully automatic hard cases. Batch Lab-seed path remains non-blocking. Transparent vs opaque export semantics intact. White sneakers and some handle/halo artifacts still need manual edits.

## Metrics (six hard fixtures, definite labels)

| Fixture | IoU | Notes |
| --- | --- | --- |
| 05_coat | 0.947 | Strong |
| 06_sweater | 0.894 | Residual edge halo |
| 07_dress | 0.888 | Thin straps |
| 08_sneakers | 0.339 | White-on-near-white limit |
| 09_handbag | 0.939 | Open-arch residual AA |
| 10_cap | 0.897 | Restored after flat-card strip fix |

## Tests

115 tests · typecheck · build — pass

## Export reminder

Beige ZIP corners with α=255 = selected opaque replacement background, not failed transparency.
