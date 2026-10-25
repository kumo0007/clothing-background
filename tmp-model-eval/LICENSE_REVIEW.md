# Candidate model license review (before any weight download)

**Date:** 2026-10-26  
**Rule:** Do not download or integrate a model until this file documents its status.

## Baseline (current production)

| Component | License | Commercial? |
| --- | --- | --- |
| `bg-remove-sdk@0.1.0` | MIT | Yes (code) |
| Weights `briaai/RMBG-1.4` | `bria-rmbg-1.4` non-commercial / evaluation | **No** without BRIA agreement |

---

## Candidate A — U²-Netp ONNX

| Field | Evidence |
| --- | --- |
| Weights file | `u2netp.onnx` (4 574 861 B / ~4.36 MiB), SHA-256 `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` (verified after download) |
| Mirror | https://huggingface.co/edgetools/u2netp (Apache-2.0 card; verbatim rembg asset) |
| Upstream model | https://github.com/xuebinqin/U-2-Net — **Apache License 2.0** |
| Author on weights | Xuebin Qin (issue #208): “All the released codes and models in this repo follow the same license currently.” |
| rembg packaging | MIT covers **code only**; rembg maintainer confirms weights remain under upstream Apache-2.0 (issue #837) |
| Commercial use | Apache-2.0 grants commercial use/redistribution subject to license conditions |
| Redistribution | Include Apache-2.0 license text; retain notices; state modifications |
| Attribution | Cite Qin et al. U²-Net paper / repo |
| Residual risk | Authors asked users to check **dataset** licenses (DUTS for u2netp). Dataset terms are separate from the Apache grant on the released checkpoints — flag for counsel; not treated as a hard exclude given explicit author statement on model license |
| Download for eval? | **Yes** — after this document |
| Commercial default candidate? | Eligible **if** cutout quality is acceptable |

## Candidate B — BiRefNet-lite 512 (`studioludens/birefnet-lite-512`)

| Field | Evidence |
| --- | --- |
| Declared repo license | MIT (model card + LICENSE); weights claimed MIT |
| Upstream | `ZhengPeng7/BiRefNet_lite` MIT (code + HF weights) |
| Training data | **DIS5K** listed on model card (`datasets: ZhengPeng7/DIS5K`) |
| DIS5K issue | Dataset ToU: commercial use of the **dataset** prohibited without authors’ permission; whether that restriction attaches to **trained weights** is **unresolved** (also noted by third-party products) |
| Commercial rights established? | **No — insufficient** for intended commercial catalog deployment without counsel clearance |
| Download for eval? | **No** (excluded per project rule until rights are clear) |
| Production default? | **Excluded** |

## Candidate C — MODNet / imgly ISNet

| Candidate | Why excluded |
| --- | --- |
| MODNet | Portrait/person oriented; poor product/garment fit |
| `@imgly/background-removal` ISNet | **AGPL-3.0** package license — commercial SaaS conflict without AGPL compliance |

---

## Decision for this milestone

1. Benchmark **U²-Netp only** (licensed for commercial evaluation under Apache-2.0).  
2. Do **not** download BiRefNet-lite until DIS5K/commercial attachment is cleared by counsel.  
3. Switch production default **only** if U²-Netp quality is acceptable on clothing fixtures; otherwise leave RMBG-1.4 path intact and keep BRIA license as the commercial blocker.

---

## Post-benchmark outcome (2026-10-26)

| Step | Result |
| --- | --- |
| U²-Netp download | Done — SHA-256 matches table above; Apache-2.0 text stored beside weights |
| BiRefNet-lite download | Skipped (rights insufficient) |
| Quality gate | **Failed** — see `COMMERCIAL_MODEL_COMPARISON_REPORT.md` |
| Production default | **Unchanged** (`bg-remove-sdk-rmbg1.4`) |
| Commercial blocker | Still **BRIA RMBG-1.4** (no quality-passing cleared alternative) |
