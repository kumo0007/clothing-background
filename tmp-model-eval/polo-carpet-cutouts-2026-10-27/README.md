# White polo on carpet — BiRefNet cutouts

**Use for background swap:** RGBA files in `transparent/` (alpha = soft KEEP).  
Do not mutate source RGB; composite cutout over any new background.

## Recommended per shot

| ID | Content | Prefer | Notes |
| --- | --- | --- | --- |
| polo-1 | Full polo flat | **BiRefNet** | Clean silhouette; Lab grossly over-kept carpet (~96%). |
| polo-2 | Full polo angled | **BiRefNet** | Clean cutout. |
| polo-3 | Full + yellow tape | **BiRefNet** | Shirt + tape kept; carpet removed. |
| polo-4 | Full + black/white tape | **BiRefNet** | Same. |
| polo-5 | Collar close-up | **BiRefNet** | Collar/tags preserved. |
| polo-6 | Tape close-up on fabric | Mixed | BiRefNet mostly **tape only** (white fabric ≈ carpet). Inspect Lab cutout if you need more shirt. |
| polo-7 | Full + tape | **BiRefNet** | Usable product cutout. |
| polo-8 | Tape edge close-up | Mixed | BiRefNet keeps dark tape; white fabric often lost. |

White garment on beige carpet remains a hard case — especially extreme close-ups.

## Outputs

| Folder | Contents |
| --- | --- |
| `transparent/` | BiRefNet RGBA cutouts (primary for compositing) |
| `lab-transparent/` | Lab-seed RGBA (compare when BiRefNet under-segs) |
| `masks/` | Grayscale KEEP masks |
| `magenta/` / `beige/` | Edge-inspection composites |
| `sources/` | Copies of inputs |

## Metrics

| ID | BiRef KEEP% | Lab KEEP% | BiRef ms |
| --- | ---: | ---: | ---: |
| polo-1 | 40.04 | 96.3 | 8422 |
| polo-2 | 40.63 | 43.97 | 7064 |
| polo-3 | 68.78 | 41.26 | 7340 |
| polo-4 | 50.35 | 39.21 | 8232 |
| polo-5 | 73.89 | 33.1 | 6249 |
| polo-6 | 15.15 | 33.4 | 6388 |
| polo-7 | 49.84 | 61.85 | 6419 |
| polo-8 | 17.21 | 45.8 | 6372 |

Re-run: `npx tsx scripts/cutoutUserPoloCarpet.mts`
