# Garment Background Studio

Client-side garment photo tool built with React, TypeScript, and the HTML Canvas API. No backend, no AI, and no external image-processing APIs.

## Phase 1 (complete)

- Vite + React + TypeScript project foundation
- Multi-image upload (file picker and drag-and-drop)
- Thumbnail gallery with select / remove / clear-all
- Canvas preview of the selected image

## Phase 2 (complete)

- Per-image mask editor (KEEP / REMOVE brush, polygon, pan)
- Brush size, zoom, pan, undo/redo, clear, invert
- Original / Mask / Result view modes
- Solid color, custom image, or transparent backgrounds
- Local Canvas compositing: `original × mask + background × (1 − mask)`

## Phase 3 (complete)

- **Adjust & Export** studio per image
- Brightness / contrast / saturation (explicit Canvas filters)
- Rotate 90°, flip horizontal / vertical
- Normalized crop controls
- Border width + color
- PNG / JPEG download (local only)
- Gallery preview applies the same final pipeline

## Phase 4 (complete)

- **Batch** panel in the gallery
- Apply selected image's background to all
- Apply selected image's adjustments to all
- Auto-mask all via corner-color removal (same as Similar → Remove corner background), then hole-fill / gap-close / chrome strip
- Download ZIP of all results, or masked-only, as PNG or JPEG (`fflate`, local)

## Phase 5 (complete)

- **Skew X / Skew Y** (−45°…45°) in Adjust & Export
- Applied after crop and before rotate/flip; output canvas expands to fit
- Included when applying adjustments to all / ZIP export
- Reset skew control; reset adjustments clears skew

## Phase 6 (complete)

- **Mask refine** tools in the Mask Editor (mask pixels only)
- Morphological **opening** (smooth spikes / speckles) and **closing** (fill small gaps)
- **Fill holes** — enclosed REMOVE regions that do not touch the border
- **Feather edges** — soft gray alpha along the KEEP/REMOVE boundary (radius 1–12)
- All refine steps are undoable; original garment pixels are never rewritten

## Phase 7 (complete)

- **Output size** in Adjust & Export (after border)
- Presets: Original, 1000×1000, 1200×1200, 800×1000, 2000×2000
- Custom width/height (64–4096)
- Fit modes: contain (pad), cover (crop), stretch
- Pad color for contain/cover letterboxing
- Included when applying adjustments to all / ZIP export

## Phase 8 (complete)

- **Product shadow** in Adjust & Export (from the KEEP mask silhouette)
- Presets: Off, Soft contact, Drop, Long
- Blur / offset X/Y / opacity / color (Canvas only — no AI)
- Drawn under the garment on backdrop pixels; garment RGB unchanged
- Requires a mask; included when applying adjustments to all / ZIP export

### Pipeline

```
original (+ mask × background)
        ↓
 color adjustments
        ↓
  product shadow
        ↓
       crop
        ↓
       skew
        ↓
   rotate / flip
        ↓
      border
        ↓
   output size
        ↓
  preview / export / ZIP
```

### Mask convention

New masks start **all black**. Paint **Keep** (white) over the garment. Original image pixels are never rewritten or regenerated.

For flat product shots (shirt on a gray card), use **Similar → Remove corner background**, batch **Auto-mask all (corners)**, or **Similar + Keep** and click the garment. A rough brush over the whole card would incorrectly keep the card in the result.

After auto-mask, use **Refine** to fill holes, close small gaps, or feather edges for a softer composite.

### Final phase

**Phase 8 is the last product phase** for this studio. Remaining ideas are intentionally out of scope:

- OpenCV.js packaging — not needed; morph / select-similar already use local Canvas CV
- AI tools — excluded by design (no backend, no external image APIs)

## Scripts

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

## Manual Phase 7 checklist

1. Upload catalog → auto-mask → set background → **Adjust & Export**.
2. Pick **1000×1000** (contain) → confirm canvas is square with pad color.
3. Switch fit to **cover** / **stretch**; download PNG.
4. **Apply adjustments to all** → ZIP; open a few files and confirm dimensions.

## Manual Phase 8 checklist

1. Upload catalog → **Auto-mask all** → solid white background → **Adjust & Export**.
2. Pick **Soft contact** shadow → confirm a soft shade under the garment, not on it.
3. Try **Drop** / **Long**; tweak blur and opacity; download PNG.
4. **Apply adjustments to all** → ZIP; spot-check shadows are consistent.

## Test packs

- `testdata/phase2_pack/` — eight 1000×1200 PNGs. Served at `/testdata/phase2_pack/`.
- `testdata/fashion_catalog/` — 12 garments + 6 backgrounds. Served at `/testdata/fashion_catalog/`.
- `testdata/phase2_retest/` — prior `*-result.png` exports used for regression checks.
- `testdata/phase2_zip_fixed/` — Phase 5 chrome/skew-padding regression outputs.
