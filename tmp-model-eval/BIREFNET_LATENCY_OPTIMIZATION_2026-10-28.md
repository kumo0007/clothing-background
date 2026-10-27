# BiRefNet WASM latency investigation

**Date:** 2026-10-28  
**Constraint:** No model / weight / threshold / preprocess / postprocess / polarity / cleanup / second-model changes.  
**Outcome:** **Production path left unchanged** — profiling did not support a safe material optimization.

Artifacts: `tmp-model-eval/birefnet-latency-profile-2026-10-28/profile.json`

---

## 1. Root cause (measured)

Stage share on a **5-image Node WASM batch** (same preprocess → `session.run` → postprocess as production):

| Stage | Share of batch wall time |
| --- | ---: |
| **`session.run` (WASM inference)** | **99.0%** |
| `reviewSdkMask` | 0.5% |
| decode | 0.2% |
| preprocess | 0.2% |
| postprocess (`logitsToMaskBuffer`) | 0.1% |

**Cold path** is dominated by **ORT WASM session creation** (~9–10 s Node / ~14 s browser previously), i.e. loading the ~94 MB FP16 graph — not image decode or canvas.

**Warm single-image** wall time ≈ one `session.run` (~11–13 s). First run after create ≈ subsequent runs (no separate “warmup tax” beyond the run itself).

So latency is **not** dominated by sequential batch scheduling, redundant canvas work, or review — it is **WASM BiRefNet compute** (plus cold session load).

---

## 2. Before / after benchmarks

Production code was **not** modified for speed. After = before.

### Node WASM (this host, `profileBirefNetLatency.mts`)

| Metric | Before (measured) | After |
| --- | ---: | ---: |
| Cold session create (path) | **9137 ms** | same |
| Cold session create (ArrayBuffer) | 9973 ms (no win vs path) | — |
| Warm `session.run` (sneakers) | **12 957 ms** | same |
| Preprocess / postprocess / review | 14 / 23 / 72 ms | same |
| 5-image batch total | **61 761 ms** | same |
| KEEP% vs baseline | Δ = 0 all five | same |

### Browser Chrome WASM (prior production-readiness bench)

| Metric | Measured |
| --- | ---: |
| Cold session create | 14 456 ms |
| Warm reuse | 12 113 ms |
| 5-image sequential infer total | 60 351 ms |

### Thread / concurrency probes (Node)

| Experiment | Result |
| --- | --- |
| `numThreads` 1 / 2 / 4 warm mean | **10 893 / 11 039 / 11 120 ms** — **1 is best**; KEEP identical |
| Parallel `session.run` ×2 same session | ~2% wall change vs sequential — **no meaningful speedup**; would not justify dual peak memory |
| App batch concurrency | Remains **1** (shared session; mobile RAM) |

---

## 3. Opportunities considered (evidence)

| Idea | Evidence | Action |
| --- | --- | --- |
| Raise WASM `numThreads` | Slower than 1 on this host | **No** |
| Parallel infer / concurrency &gt; 1 | ≈ no speedup; risk of duplicate pressure | **No** |
| Create session from ArrayBuffer vs URL/path | Buffer create **slower** here | **No** |
| Skip redundant `loadHtmlImage` in batch | Saves tens of ms vs ~12 s/run | **No** (immaterial) |
| Pipeline decode∥infer | Decode ≪ 1% of batch | **No** |
| Enable cleanup / under-recall | Forbidden; also quality-regressing | **No** |
| WebGPU | Degenerate logits on this host | **No** |
| Change model / 512 size / quant | Forbidden (segmentation behavior) | **No** |

Session reuse is **already** implemented (`preloadBirefNetModel` shared handle). App already preloads once per batch.

---

## 4. Fixture regression (mask-level)

Locked in `src/lib/mask/birefNet/fixtureKeepBaseline.ts` and checked by `scripts/assertBirefNetFixtureRegression.mts`:

| Fixture | KEEP% | Mask SHA-256 (prefix) |
| --- | ---: | --- |
| dark-hoodie | 55.43 | `7302ea6c…` |
| white-tshirt | 49.04 | `89c9860e…` |
| white-sneakers | 34.5 | `28792c68…` |
| open-handbag | 35.68 | `11ce582d…` |
| polo-carpet-closeup | 73.89 | `c8b12ac9…` |

Vitest: always-on baseline lock test + optional `BIREFNET_FIXTURE_REGRESSION=1` full WASM suite.

---

## 5. Files changed

| File | Rationale |
| --- | --- |
| `scripts/profileBirefNetLatency.mts` | Stage attribution |
| `scripts/profileBirefNetThreads.mts` | Thread comparison |
| `scripts/assertBirefNetFixtureRegression.mts` | Pixel/KEEP regression runner |
| `src/lib/mask/birefNet/fixtureKeepBaseline.ts` | Golden KEEP% + SHA |
| `src/lib/mask/birefNet/fixtureKeepBaseline.test.ts` | Always-on lock vs independent verify |
| `src/lib/mask/birefNet/birefNet.fixtureRegression.test.ts` | Opt-in full mask regression |
| `tmp-model-eval/BIREFNET_LATENCY_OPTIMIZATION_2026-10-28.md` | This report |

**No changes** to `session.ts` / `segment.ts` / App concurrency / preprocess / postprocess.

---

## 6. Remaining bottlenecks

1. **Warm WASM `session.run` ~11–13 s/image** for BiRefNet_lite 512 FP16 — algorithmic/EP cost of this checkpoint in ORT WASM.  
2. **Cold session create ~9–14 s** (one-time per tab if preloaded).  
3. Faster paths would require a **different EP that preserves logits** (WebGPU currently does not on this host), **hardware**, or a **different model** — all out of scope for this pass.

Manual brush / polygon workflows untouched. Segmentation semantics unchanged by leaving the path alone.
