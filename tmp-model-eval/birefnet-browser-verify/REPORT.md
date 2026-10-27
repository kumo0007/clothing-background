# BiRefNet browser verification (WebGPU + WASM)

## WebGPU

```json
{
  "ok": true,
  "methodId": "birefnet-lite-512",
  "device": "webgpu",
  "requestedEp": "webgpu",
  "hasGpu": true,
  "webgpuError": null,
  "epFallback": null,
  "degenerate": true,
  "coldMs": 11802,
  "warm1Ms": 9198,
  "warm2Ms": 6093,
  "keepRatio": 0,
  "softRatio": 1,
  "nonFinite": 0,
  "rawMin": -4.277344,
  "rawMax": -1.830078,
  "alreadyProb": false,
  "dims": [
    1,
    1,
    512,
    512
  ],
  "logitsLen": 262144,
  "centerMean": 0.0227,
  "borderMean": 0.0267,
  "polarityLikelyCorrect": false,
  "meaningfulKeep": false,
  "inputName": "input_image",
  "outputName": "output_image",
  "notSilentRmbg": true,
  "sourceSize": {
    "w": 294,
    "h": 291
  }
}
```

## WASM

```json
{
  "ok": true,
  "methodId": "birefnet-lite-512",
  "device": "wasm",
  "requestedEp": "wasm",
  "hasGpu": true,
  "webgpuError": null,
  "epFallback": null,
  "degenerate": false,
  "coldMs": 15831,
  "warm1Ms": 14525,
  "warm2Ms": 12326,
  "keepRatio": 0.345,
  "softRatio": 0.0109,
  "nonFinite": 0,
  "rawMin": -19.118488,
  "rawMax": 18.28524,
  "alreadyProb": false,
  "dims": [
    1,
    1,
    512,
    512
  ],
  "logitsLen": 262144,
  "centerMean": 1,
  "borderMean": 0,
  "polarityLikelyCorrect": true,
  "meaningfulKeep": true,
  "inputName": "input_image",
  "outputName": "output_image",
  "notSilentRmbg": true,
  "sourceSize": {
    "w": 294,
    "h": 291
  }
}
```
