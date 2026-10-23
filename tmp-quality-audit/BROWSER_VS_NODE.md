# Browser vs Node segmentation path

## Node / Vite-node (this audit)

| Field | Value |
| --- | --- |
| Environment | Node (scripts via `vite-node`) |
| OpenCV.js load | Succeeds (`tryLoadOpenCv` → true) |
| `grabCut` API present | **false** in the runtime used by `segmentGarmentWithOpenCv` under Vite-node |
| Method recorded | `opencv-seed-fallback` for all 10 clothing fixtures |
| Meaning | Lab-seed mask only — **not** GrabCut. Do not treat seed-fallback exports as GrabCut success. |

Documented reason (see `segmentGarment.ts`): GrabCut WASM under Vite/Node has historically hung or been unavailable; the seed path is an intentional, labeled fallback.

## Browser (OpenCV.js WASM)

- Production UI loads `@techstark/opencv-js` in the browser bundle (`opencv-*.js` chunk in `vite build`).
- When `cv.grabCut` exists and models use `CV_64FC1`, method should report `opencv-grabcut`.
- This audit did **not** drive a live browser page; browser GrabCut must be verified separately in the app (DevTools / on-screen method badge if exposed).
- Initialization failure must surface as `opencv` load error or explicit fallback — never silent “GrabCut ok” when seeds ran.

## Consistency rule

Compare masks only within the same `methodUsed`. A Node seed-fallback result is not evidence that the browser GrabCut path is healthy.
