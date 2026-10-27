#!/usr/bin/env python3
"""Compare stock vs GatherND-rewritten ONNX on CPU (onnxruntime).

Reports max abs / MAE on output logits for a fixed ImageNet-normalized input.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[2]
STOCK = ROOT / "public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx"
REWRITTEN = (
    ROOT
    / "tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/model_fp16.gathernd_rewrite.onnx"
)
OUT = ROOT / "tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28"
EXPECTED_SHA = "eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516"
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 3, 1, 1)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 3, 1, 1)


def make_input(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    # Synthetic RGB in [0,1] then ImageNet-normalize (matches browser preprocess scale).
    rgb = rng.random((1, 3, 512, 512), dtype=np.float32)
    return (rgb - MEAN) / STD


def run(path: Path, feed: np.ndarray) -> np.ndarray:
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(
        str(path),
        sess_options=so,
        providers=["CPUExecutionProvider"],
    )
    inp = sess.get_inputs()[0].name
    out = sess.get_outputs()[0].name
    result = sess.run([out], {inp: feed})[0]
    return np.asarray(result)


def main() -> None:
    raw = STOCK.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == EXPECTED_SHA
    if not REWRITTEN.exists():
        raise SystemExit(f"missing rewritten model: {REWRITTEN}")

    feed = make_input(0)
    print("running stock…")
    a = run(STOCK, feed)
    print("running rewritten…")
    b = run(REWRITTEN, feed)

    if a.shape != b.shape:
        raise SystemExit(f"shape mismatch {a.shape} vs {b.shape}")
    diff = np.abs(a.astype(np.float64) - b.astype(np.float64))
    report = {
        "inputSeed": 0,
        "outputShape": list(a.shape),
        "stockDtype": str(a.dtype),
        "rewrittenDtype": str(b.dtype),
        "maxAbsDiff": float(diff.max()),
        "meanAbsDiff": float(diff.mean()),
        "p99AbsDiff": float(np.percentile(diff, 99)),
        "exactEqual": bool(np.array_equal(a, b)),
        "allclose_1e5": bool(np.allclose(a, b, rtol=0, atol=1e-5)),
        "allclose_1e3": bool(np.allclose(a, b, rtol=0, atol=1e-3)),
        "allclose_1e2": bool(np.allclose(a, b, rtol=0, atol=1e-2)),
        "stockFinite": bool(np.isfinite(a).all()),
        "rewrittenFinite": bool(np.isfinite(b).all()),
        "stockMin": float(np.min(a)),
        "stockMax": float(np.max(a)),
        "rewrittenMin": float(np.min(b)),
        "rewrittenMax": float(np.max(b)),
    }
    (OUT / "cpu-equivalence.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["rewrittenFinite"] or not report["stockFinite"]:
        raise SystemExit("non-finite logits")
    # Strict: prefer exact; accept tiny FP16 roundtrip only if documented.
    if report["exactEqual"]:
        print("EXACT equivalence")
    elif report["allclose_1e3"]:
        print("NEAR equivalence (atol 1e-3) — review before WebGPU ship")
    else:
        print("NOT equivalent — rewrite blocked")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
