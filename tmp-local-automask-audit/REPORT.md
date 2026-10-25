# Local Lab-seed auto-mask audit

Path: `segmentImageLocally` → `runLabSeedAutoMask` (no Poof / ISNet / GrabCut).

| Fixture | Method | Size | KEEP% | soft% | borderKEEP% | needsReview | ms |
|---|---|---|---|---|---|---|---|
| 01_hoodie.jpg | opencv-seed-fallback | 298×292 | 46.2 | 3.83 | 0.0 | false | 2013 |
| 02_blazer.jpg | opencv-seed-fallback | 294×292 | 57.9 | 2.18 | 0.0 | false | 1423 |
| 03_tshirt.jpg | opencv-seed-fallback | 294×292 | 62.9 | 1.72 | 0.0 | true | 1977 |
| 04_jeans.jpg | opencv-seed-fallback | 294×292 | 38.1 | 2.40 | 0.0 | false | 693 |
| 05_coat.jpg | opencv-seed-fallback | 296×292 | 41.0 | 1.03 | 0.0 | false | 586 |
| 10_cap.jpg | opencv-seed-fallback | 296×291 | 27.7 | 1.08 | 0.0 | false | 1387 |
| 08_sneakers.jpg | opencv-seed-fallback | 294×291 | 13.4 | 5.01 | 0.0 | true | 1389 |
| 09_handbag.jpg | opencv-seed-fallback | 294×291 | 36.2 | 2.84 | 0.0 | false | 1169 |
| 06_sweater.jpg | opencv-seed-fallback | 298×291 | 48.3 | 1.92 | 0.0 | false | 852 |
| 07_dress.jpg | opencv-seed-fallback | 294×291 | 20.2 | 1.08 | 0.0 | false | 513 |

Fetch calls during audit: **0** (must be 0).

## Notes

- High `borderKEEP%` or extreme KEEP% often warrants manual review.
- White-on-white (tee, sneakers) and openings (handbag) are classical-CV hard cases.
- Soft% > 0 shows partial alpha along edges was preserved (not binary-thresholded away).
