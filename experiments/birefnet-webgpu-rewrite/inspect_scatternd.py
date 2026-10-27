#!/usr/bin/env python3
"""Summarize ScatterND patterns in stock BiRefNet FP16."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

import onnx
from onnx import shape_inference

ROOT = Path(__file__).resolve().parents[2]
STOCK = ROOT / "public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx"
OUT = ROOT / "tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28"
EXPECTED_SHA = "eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516"


def dims_of(vi):
    dims = []
    for d in vi.type.tensor_type.shape.dim:
        if d.dim_value:
            dims.append(int(d.dim_value))
        elif d.dim_param:
            dims.append(d.dim_param)
        else:
            dims.append("?")
    return dims


def main() -> None:
    raw = STOCK.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == EXPECTED_SHA
    model = onnx.load(str(STOCK), load_external_data=False)
    try:
        model = shape_inference.infer_shapes(model)
    except Exception as exc:  # noqa: BLE001
        print("shape warn", exc)
    vi = {v.name: v for v in list(model.graph.value_info) + list(model.graph.input) + list(model.graph.output)}
    patterns = Counter()
    split_arity = Counter()
    concat_arity = Counter()
    for n in model.graph.node:
        if n.op_type == "Split":
            split_arity[len(n.output)] += 1
        if n.op_type == "Concat":
            concat_arity[len(n.input)] += 1
        if n.op_type != "ScatterND":
            continue
        shapes = []
        for name in n.input[:3]:
            if name in vi:
                shapes.append(dims_of(vi[name]))
            else:
                shapes.append("?")
        patterns[str(tuple(shapes))] += 1
    report = {
        "scatterNdPatterns": dict(patterns.most_common()),
        "splitOutputArity": dict(sorted(split_arity.items())),
        "concatInputArity": dict(sorted(concat_arity.items())[-15:]),
        "maxSplitOutputs": max(split_arity) if split_arity else 0,
        "maxConcatInputs": max(concat_arity) if concat_arity else 0,
    }
    (OUT / "scatternd-inspect.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
