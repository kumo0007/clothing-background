# BiRefNet latency profile

Generated: 2026-10-27T16:30:14.813Z

## Cold

```json
{
  "probeMs": 32.3,
  "sessionCreateFromBufferMs": 9973.2,
  "sessionCreateFromPathMs": 9136.9
}
```

## Warm single (sneakers)

```json
{
  "preprocessMs": 13.7,
  "firstRunAfterCreateMs": 12644.2,
  "sessionRunMs": 12956.8,
  "postprocessMs": 22.8,
  "reviewMs": 72,
  "decodeJpegMs": 23.3,
  "doubleDecodeMs": 38.3
}
```

## Batch stage share

```json
{
  "decode": 0.2,
  "preprocess": 0.2,
  "sessionRun": 99,
  "postprocess": 0.1,
  "review": 0.5
}
```

Batch total: 61760.9 ms

## Concurrency

```json
{
  "sequentialTwoMs": 24046.8,
  "parallelTwoMs": 23486.6,
  "parallelError": null,
  "conclusion": "Parallel offered little/no speedup — keep concurrency 1 (avoid dual memory)"
}
```
