# Final Segmentation Quality Audit

Generated: 2026-10-23T10:31:30.245Z

**Verdict:** NOT production-ready for fully automatic segmentation: significant white-on-near-white damage and/or visible contamination remain on hard fixtures.

Production-ready automatic segmentation: **NO**

## Runtime path

```json
{
  "environment": "node",
  "openCvLoaded": true,
  "grabCutApiPresent": false,
  "note": "Under Vite/Node, GrabCut WASM often hangs or is skipped; methodUsed=opencv-seed-fallback is the documented Node path and is NOT evidence that GrabCut ran."
}
```

## Reference policy

- Independent definite FG/BG from appearance + border flood — **not** manual paint and **not** the algorithm mask.
- Uncertain (pale near-card, soft shadow, white leather candidates) excluded from binary metrics.
- Soft alpha MAE reported on definite FG edge band separately.

## Per-fixture results

### 01_hoodie.jpg

- Method: `opencv-seed-fallback` · 1159 ms · source RGB unchanged: true
- Reference coverage: FG=36210 BG=37169 uncertain=13637 (15.7%)
- Binary (definite only): FG P/R=0.8453/0.9969 · BG P/R=0.9963/0.8223 · IoU=0.8431 · Dice=0.9149
- Garment miss=0.0031 · BG contamination=0.1777
- Boundary (tol=2): accuracy=0.9821 · softAlphaMae=0.0339 · band=1959px
- Internal hole proxy: 0px / 0 components
- Halo proxy (bright KEEP on edge): 0px (0.0% of edge)
- Root cause: Acceptable definite-label agreement on dark/chromatic mass.
- Remaining: Definite BG contamination 17.8%.
- Exports: `D:\project\tmp-quality-audit\exports\01_hoodie-result.png` · mask · ref `D:\project\tmp-quality-audit\reference\01_hoodie-ref.png`

### 02_blazer.jpg

- Method: `opencv-seed-fallback` · 777 ms · source RGB unchanged: true
- Reference coverage: FG=49568 BG=34379 uncertain=1901 (2.2%)
- Binary (definite only): FG P/R=0.8222/0.9892 · BG P/R=0.978/0.6916 · IoU=0.8149 · Dice=0.898
- Garment miss=0.0108 · BG contamination=0.3084
- Boundary (tol=2): accuracy=0.8691 · softAlphaMae=0.1871 · band=1535px
- Internal hole proxy: 0px / 0 components
- Halo proxy (bright KEEP on edge): 0px (0.0% of edge)
- Root cause: Acceptable definite-label agreement on dark/chromatic mass.
- Remaining: Definite BG contamination 30.8%.
- Exports: `D:\project\tmp-quality-audit\exports\02_blazer-result.png` · mask · ref `D:\project\tmp-quality-audit\reference\02_blazer-ref.png`

### 03_tshirt.jpg (hard case)

- Method: `opencv-seed-fallback` · 1134 ms · source RGB unchanged: true
- Reference coverage: FG=380 BG=43298 uncertain=42170 (49.1%)
- Binary (definite only): FG P/R=0.0285/0.9921 · BG P/R=0.9999/0.7036 · IoU=0.0285 · Dice=0.0555
- Garment miss=0.0079 · BG contamination=0.2964
- Boundary (tol=2): accuracy=1 · softAlphaMae=0.0049 · band=243px
- Internal hole proxy: 0px / 0 components
- Halo proxy (bright KEEP on edge): 0px (0.0% of edge)
- Root cause: White tee vs near-white card: large uncertain band; border-connected studio may remain as bright KEEP fringe.
- Remaining: White-on-near-white contamination not fully measurable as FG miss; visual halo/contamination remains. Definite BG contamination 29.6%.
- Exports: `D:\project\tmp-quality-audit\exports\03_tshirt-result.png` · mask · ref `D:\project\tmp-quality-audit\reference\03_tshirt-ref.png`

### 04_jeans.jpg

- Method: `opencv-seed-fallback` · 509 ms · source RGB unchanged: true
- Reference coverage: FG=31732 BG=53510 uncertain=606 (0.7%)
- Binary (definite only): FG P/R=0.7614/0.9919 · BG P/R=0.9941/0.8156 · IoU=0.7566 · Dice=0.8615
- Garment miss=0.0081 · BG contamination=0.1844
- Boundary (tol=2): accuracy=0.9731 · softAlphaMae=0.0534 · band=2197px
- Internal hole proxy: 12px / 1 components
- Halo proxy (bright KEEP on edge): 0px (0.0% of edge)
- Root cause: Acceptable definite-label agreement on dark/chromatic mass.
- Remaining: Definite BG contamination 18.4%.
- Exports: `D:\project\tmp-quality-audit\exports\04_jeans-result.png` · mask · ref `D:\project\tmp-quality-audit\reference\04_jeans-ref.png`

### 05_coat.jpg (hard case)

- Method: `opencv-seed-fallback` · 402 ms · source RGB unchanged: true
- Reference coverage: FG=33764 BG=51235 uncertain=1433 (1.7%)
- Binary (definite only): FG P/R=0.9534/0.993 · BG P/R=0.9953/0.968 · IoU=0.9471 · Dice=0.9728
- Garment miss=0.007 · BG contamination=0.032
- Boundary (tol=2): accuracy=0.9495 · softAlphaMae=0.0698 · band=1267px
- Internal hole proxy: 0px / 0 components
- Halo proxy (bright KEEP on edge): 0px (0.0% of edge)
- Root cause: Dark garment definite FG is strong; residual halos are soft-studio / AA on silhouette (scored partly via haloProxy + boundary).
- Exports: `D:\project\tmp-quality-audit\exports\05_coat-result.png` · mask · ref `D:\project\tmp-quality-audit\reference\05_coat-ref.png`

### 06_sweater.jpg (hard case)

- Method: `opencv-seed-fallback` · 683 ms · source RGB unchanged: true
- Reference coverage: FG=46421 BG=35648 uncertain=4649 (5.4%)
- Binary (definite only): FG P/R=0.9922/0.901 · BG P/R=0.8848/0.9907 · IoU=0.8946 · Dice=0.9444
- Garment miss=0.099 · BG contamination=0.0093
- Boundary (tol=2): accuracy=0.675 · softAlphaMae=0.378 · band=2043px
- Internal hole proxy: 9px / 1 components
- Halo proxy (bright KEEP on edge): 0px (0.0% of edge)
- Root cause: Dark garment definite FG is strong; residual halos are soft-studio / AA on silhouette (scored partly via haloProxy + boundary).
- Remaining: Definite garment miss rate 9.9%.
- Exports: `D:\project\tmp-quality-audit\exports\06_sweater-result.png` · mask · ref `D:\project\tmp-quality-audit\reference\06_sweater-ref.png`

### 07_dress.jpg (hard case)

- Method: `opencv-seed-fallback` · 571 ms · source RGB unchanged: true
- Reference coverage: FG=18667 BG=63519 uncertain=3368 (3.9%)
- Binary (definite only): FG P/R=0.9631/0.9132 · BG P/R=0.9749/0.9897 · IoU=0.8823 · Dice=0.9375
- Garment miss=0.0868 · BG contamination=0.0103
- Boundary (tol=2): accuracy=0.4605 · softAlphaMae=0.5537 · band=2378px
- Internal hole proxy: 0px / 0 components
- Halo proxy (bright KEEP on edge): 0px (0.0% of edge)
- Root cause: Thin straps are definite dark FG when L is low; soft AA around straps and neckline may remain uncertain.
- Remaining: Strap width at ~1–2px is fragile under aggressive peel. Definite garment miss rate 8.7%.
- Exports: `D:\project\tmp-quality-audit\exports\07_dress-result.png` · mask · ref `D:\project\tmp-quality-audit\reference\07_dress-ref.png`

### 08_sneakers.jpg (hard case)

- Method: `opencv-seed-fallback` · 888 ms · source RGB unchanged: true
- Reference coverage: FG=6385 BG=65915 uncertain=13254 (15.5%)
- Binary (definite only): FG P/R=0.3688/0.8013 · BG P/R=0.9783/0.8672 · IoU=0.3379 · Dice=0.5051
- Garment miss=0.1987 · BG contamination=0.1328
- Boundary (tol=2): accuracy=0.8349 · softAlphaMae=0.2212 · band=2938px
- Internal hole proxy: 0px / 0 components
- Halo proxy (bright KEEP on edge): 0px (0.0% of edge)
- Root cause: White/near-white leather vs studio card is Lab-ambiguous; definite FG covers dark soles/mesh only. Global Lab loosen would eat card.
- Remaining: Significant white leather KEEP damage vs human intent — not production-ready for white-on-near-white without manual correction. Uncertain-region metrics cannot fully quantify leather loss. Definite garment miss rate 19.9%. Definite BG contamination 13.3%.
- Exports: `D:\project\tmp-quality-audit\exports\08_sneakers-result.png` · mask · ref `D:\project\tmp-quality-audit\reference\08_sneakers-ref.png`

### 09_handbag.jpg (hard case)

- Method: `opencv-seed-fallback` · 609 ms · source RGB unchanged: true
- Reference coverage: FG=32021 BG=45174 uncertain=8359 (9.8%)
- Binary (definite only): FG P/R=0.9845/0.9519 · BG P/R=0.9667/0.9894 · IoU=0.9378 · Dice=0.9679
- Garment miss=0.0481 · BG contamination=0.0106
- Boundary (tol=2): accuracy=0.5972 · softAlphaMae=0.4549 · band=2284px
- Internal hole proxy: 34px / 5 components
- Halo proxy (bright KEEP on edge): 0px (0.0% of edge)
- Root cause: Handle openings are usually border-connected through the open top of the arches (not enclosed components), so stripEnclosed / stripDarkWalled skip them. Wall-adjacent JPEG variance also blocks flat-studio strip. Magenta exports still show retained studio under handles.
- Remaining: Visible handle-interior studio remains — requires targeted open-arch background fill or manual edit, not blind enclosed-hole removal. Enclosed-hole proxy=34px (under-counts open arches that touch exterior KEEP). Thin strap AA and hardware fringes may need manual touch-up. Not safe to auto-remove all bright regions beside dark leather (hardware / leather details).
- Exports: `D:\project\tmp-quality-audit\exports\09_handbag-result.png` · mask · ref `D:\project\tmp-quality-audit\reference\09_handbag-ref.png`

### 10_cap.jpg (hard case)

- Method: `opencv-seed-fallback` · 739 ms · source RGB unchanged: true
- Reference coverage: FG=25999 BG=56858 uncertain=3279 (3.8%)
- Binary (definite only): FG P/R=0.9704/0.9151 · BG P/R=0.9622/0.9872 · IoU=0.8903 · Dice=0.942
- Garment miss=0.0849 · BG contamination=0.0128
- Boundary (tol=2): accuracy=0.4234 · softAlphaMae=0.5957 · band=2088px
- Internal hole proxy: 0px / 0 components
- Halo proxy (bright KEEP on edge): 0px (0.0% of edge)
- Root cause: Warm crown is definite FG; brim contact shadow is uncertain / mid-gray — may leave soft fringe.
- Remaining: Definite garment miss rate 8.5%.
- Exports: `D:\project\tmp-quality-audit\exports\10_cap-result.png` · mask · ref `D:\project\tmp-quality-audit\reference\10_cap-ref.png`

## Acceptance checklist

- [ ] 103+ unit tests pass (run separately)
- [ ] typecheck + build pass
- [ ] Fresh exports under `tmp-quality-audit/exports` and `tmp-quality-pass-exports`
- [ ] Original source RGB unchanged (per-fixture flag above)
- [ ] Node path recorded as seed-fallback when GrabCut WASM unavailable — not claimed as GrabCut success
