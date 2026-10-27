#!/usr/bin/env python3
"""Inspect GatherND/ScatterND nodes in the stock BiRefNet FP16 ONNX.

Immutable input: public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx
Writes: tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/gathernd-inspect.json
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

import onnx
from onnx import numpy_helper, shape_inference

ROOT = Path(__file__).resolve().parents[2]
STOCK = ROOT / "public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx"
OUT = ROOT / "tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28"
EXPECTED_SHA = "eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516"
EXPECTED_BYTES = 98_484_532


def tensor_type_str(t) -> str:
    elem = t.tensor_type.elem_type
    return onnx.TensorProto.DataType.Name(elem)


def dims_of(vi) -> list:
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
    OUT.mkdir(parents=True, exist_ok=True)
    raw = STOCK.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    if len(raw) != EXPECTED_BYTES or sha != EXPECTED_SHA:
        raise SystemExit(f"stock weight integrity failed: {len(raw)} {sha}")

    model = onnx.load(str(STOCK), load_external_data=False)
    # Best-effort shape inference (may leave some dims symbolic).
    try:
        model = shape_inference.infer_shapes(model)
    except Exception as exc:  # noqa: BLE001
        print("shape_inference warning:", exc)

    vi = {v.name: v for v in list(model.graph.value_info) + list(model.graph.input) + list(model.graph.output)}
    init = {t.name: t for t in model.graph.initializer}

    op_counts = Counter(n.op_type for n in model.graph.node)
    gather_nodes = []
    scatter_nodes = []

    for n in model.graph.node:
        if n.op_type not in ("GatherND", "ScatterND"):
            continue
        attrs = {a.name: onnx.helper.get_attribute_value(a) for a in n.attribute}
        inputs_meta = []
        for name in n.input:
            if name in init:
                arr = numpy_helper.to_array(init[name])
                inputs_meta.append(
                    {
                        "name": name,
                        "kind": "initializer",
                        "dtype": str(arr.dtype),
                        "shape": list(arr.shape),
                    }
                )
            elif name in vi:
                inputs_meta.append(
                    {
                        "name": name,
                        "kind": "value",
                        "dtype": tensor_type_str(vi[name].type),
                        "shape": dims_of(vi[name]),
                    }
                )
            else:
                inputs_meta.append({"name": name, "kind": "unknown"})
        outputs_meta = []
        for name in n.output:
            if name in vi:
                outputs_meta.append(
                    {
                        "name": name,
                        "dtype": tensor_type_str(vi[name].type),
                        "shape": dims_of(vi[name]),
                    }
                )
            else:
                outputs_meta.append({"name": name})
        row = {
            "name": n.name,
            "op": n.op_type,
            "attrs": {k: (int(v) if hasattr(v, "__int__") and not isinstance(v, bool) else v) for k, v in attrs.items()},
            "inputs": inputs_meta,
            "outputs": outputs_meta,
        }
        if n.op_type == "GatherND":
            gather_nodes.append(row)
        else:
            scatter_nodes.append(row)

    # Summarize GatherND patterns for rewrite feasibility
    patterns = Counter()
    for g in gather_nodes:
        data = g["inputs"][0] if g["inputs"] else {}
        idx = g["inputs"][1] if len(g["inputs"]) > 1 else {}
        bd = g["attrs"].get("batch_dims", 0)
        key = (
            f"data_shape={data.get('shape')}",
            f"idx_shape={idx.get('shape')}",
            f"batch_dims={bd}",
            f"data_dtype={data.get('dtype')}",
            f"idx_dtype={idx.get('dtype')}",
        )
        patterns[str(key)] += 1

    report = {
        "stock": {
            "path": str(STOCK),
            "bytes": len(raw),
            "sha256": sha,
            "verified": True,
        },
        "graph": {
            "nodeCount": len(model.graph.node),
            "opCountsTop": op_counts.most_common(40),
            "gatherNdCount": len(gather_nodes),
            "scatterNdCount": len(scatter_nodes),
            "splitCount": op_counts.get("Split", 0),
            "concatCount": op_counts.get("Concat", 0),
            "sumCount": op_counts.get("Sum", 0),
        },
        "gatherNdPatterns": dict(patterns.most_common()),
        "gatherNdSample": gather_nodes[:5],
        "scatterNdSample": scatter_nodes[:5],
        "webgpuNotes": {
            "ortIssue": "https://github.com/microsoft/onnxruntime/issues/32731",
            "fixPr": "https://github.com/microsoft/onnxruntime/pull/32733 (draft, not merged as of investigation)",
            "failureMode": "rank>=5 GatherND computeSliceOffsets Tint rejection → degenerate logits",
            "rewriteCandidate": "Reshape data spatial dims + linearize indices + Gather (claimed bit-identical on CPU in ORT issue)",
        },
    }
    (OUT / "gathernd-inspect.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "gatherNdCount": len(gather_nodes),
        "scatterNdCount": len(scatter_nodes),
        "patterns": dict(patterns.most_common(10)),
        "opTop": op_counts.most_common(15),
    }, indent=2))


if __name__ == "__main__":
    main()
