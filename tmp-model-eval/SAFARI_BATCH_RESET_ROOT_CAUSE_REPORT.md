# Safari Batch Reset — Root Cause Report

**Date:** 2026-10-28  
**Last verification:** 2026-10-28 (final gate re-run after unused-`vi` fix + stale-mask discard)  
**Symptom:** iPhone Safari returns to the initial upload screen during **Start Auto-mask all** (seven clothing images), wiping uploads / batch counters.  
**Recording:** `ScreenRecording_compressed_under20MB.mov` was referenced but **not present in the workspace**.

---

## 1. Exact root cause (evidence-ranked)

### Primary classification: **B — Safari WebContent process termination / memory pressure**

| Hypothesis | Evidence |
| --- | --- |
| **A. Full navigation / `location.reload`** | No automatic reload on Batch path. `AppErrorBoundary` reloads **only on user click**. No service worker. |
| **C. Uncaught exception** | Batch failures are caught → `processingPhase: 'failed'`. Render errors show the boundary UI, not the empty uploader. |
| **D. App-level `setImages([])`** | Only **Clear all** empties images. |
| **E. WASM/ORT failure path** | Marks images failed; does not clear the image store. |
| **B. Process kill / cold reload** | Matches empty uploader with all React state gone. Peak = BiRefNet WASM + seven uploads + redundant decode buffers. |

### Contributing defects (fixed)

1. Redundant per-image peak memory: empty full-res mask + HTMLImage warm-up + RGBA decode **before** segment’s own capped decode.  
2. Unmount cleanup revoked URLs / `clearAllMasks` / bumped batch generation (Strict Mode / remount hazard).  
3. Late `setMask` after Clear/newer batch could re-insert an orphan mask (fixed: discard when generation is stale).  
4. Missing lifecycle / interrupt diagnostics.

---

## 2. Relevant source paths

| Path | Role |
| --- | --- |
| `src/App.tsx` | Queue, concurrency=1, generation guard, Apple-mobile yield, interrupt UX |
| `src/lib/batch/autoMaskCorners.ts` | File → `segmentWithBirefNet` (no warm decode) |
| `src/lib/mask/birefNet/segment.ts` | One capped decode → 512 tensor → ORT → full-res mask |
| `src/lib/mask/birefNet/session.ts` | Shared WASM session reuse |
| `src/lib/diagnostics/safariBatchDiagnostics.ts` | Run ID, sessionStorage log, lifecycle |
| `src/components/AppErrorBoundary.tsx` | Manual reload only |

---

## 3. App unmount / remount / stale-job audit

| Concern | Behavior after fix |
| --- | --- |
| Strict Mode / remount | Unmount **does not** revoke object URLs, clear masks, or bump `batchGenerationRef` (avoids wiping uploads / cancelling a just-started batch). |
| Explicit Clear / Remove | Still revokes URLs and `deleteMask`. Clear bumps generation. |
| Newer Auto-mask run | `++batchGenerationRef` → old `isCurrent()` false → no React project updates. |
| Late maskStore write | After inference, if generation is stale → **`deleteMask(imageId)`** + diag `discarded stale mask write`. |
| True tab kill | Blob URLs and React state are gone; cannot be recovered from memory. |

**Not claimed:** surviving a hard WebContent kill with images intact (no IndexedDB persistence).

---

## 4. Single-decode path + Apple-mobile yield

- Production Batch always passes `image.file` → **no** HTMLImage/RGBA warm path in `autoMaskCorners`.  
- `segmentWithBirefNet` creates one object URL, capped decode (max edge 1600), revokes URL in `finally`, builds 512 tensor, runs shared session, maps mask to source dims.  
- No second model / threshold change. Yield:

```ts
if (appleMobile) {
  await yieldForSafariMemoryPressure()
  await new Promise((r) => setTimeout(r, 50))
}
```

Desktop / jsdom: **no** inter-image yield (mask correctness unchanged).

---

## 5. Interrupt diagnostics ≠ batch resume

| Event | Meaning |
| --- | --- |
| Interrupt marker in `sessionStorage` after reload | Soft recovery of **page/session**; UI shows warning: **batch was not resumed**. |
| Marker absent + empty app | Typical hard WebContent kill (storage wiped). |
| Marker contents | Counts / runId only — **no** pixels, blobs, or mask bytes. |

Mount copy explicitly: *“This is a warning only — the batch was not resumed.”*

Automated: `interrupt marker warns without claiming batch resume or restoring images` (App.test).

---

## 6. Seven-image browser regression (jsdom / RTL)

Test: `seven-image batch keeps queue progressing; one failure does not clear uploads`

| Check | Result |
| --- | --- |
| Start with 7 pending | Pass |
| Auto-mask called 7× | Pass |
| 6 masked + 1 failed | Pass |
| No pending / running left | Pass |
| Gallery still has 7 `<li>` | Pass |
| Error surfaces failed item | Pass |

Also retained: 8-image happy path; 3-image mid-batch failure; init failure marks queue failed.

**Not a physical Safari WebContent run** — see §9 checklist.

---

## 7. Final command results (re-run after `vi` import removal)

Executed sequentially; each exit code recorded independently (build includes `tsc -b` + Vite, not typecheck alone).

| Command | Exit code | Notes |
| --- | ---: | --- |
| `npm test -- --run` | **0** | **430 passed**, 2 skipped (71 files) |
| `npm run typecheck` | **0** | `tsc -b --pretty false` |
| `npm run lint` | **0** | Pre-existing warnings only (no errors) |
| `npm run build` | **0** | Weights validated + Vite client build OK |

Additional fix during this verification: discard stale `setMask` when batch generation is obsolete; clarify interrupt copy; seven-image + interrupt App tests.

---

## 8. Real iPhone Safari checklist (after deploy) — **PENDING**

No physical iPhone was available in this environment. Do **not** treat the issue as fully fixed until this checklist is completed on device:

1. Hard-refresh production URL on iPhone Safari (Wi‑Fi).  
2. Upload **seven** large clothing photos (similar to the field recording).  
3. Tap **Start Auto-mask all**; leave the tab foregrounded.  
4. Confirm counters: one running / others pending → completed or failed (never stuck pending forever).  
5. Confirm the app **does not** jump back to an empty uploader mid-batch.  
6. Force-fail one image if possible; confirm the other six remain and gallery count stays 7.  
7. Optional: mid-batch Home + return; note whether interrupt warning appears (soft) vs blank app (hard kill).  
8. Capture Safari console `[safariBatchDiag]` lines if a reset still occurs.  
9. Repeat with 1 image and 2 images as controls.

---

## 9. Remaining limitations

1. **Physical iPhone confirmation: PENDING.**  
2. No IndexedDB upload persistence — hard kills lose images.  
3. Older phones may still OOM on huge batches — use fewer photos.  
4. Interrupt warning only if `sessionStorage` survives.  
5. Field recording file was not in-repo for frame sync.

---

## Verdict

**Automated gates: PASS** (test / typecheck / lint / build exit 0).  
**On-device Safari seven-image confirmation: PENDING.**  

**Do not claim the product issue is fully fixed** until §8 is completed on a real iPhone against a build that includes these changes.
