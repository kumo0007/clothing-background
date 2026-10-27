#!/usr/bin/env python3
"""Semantics-preserving GatherND → Reshape + linearize + Gather rewrite.

Writes an *experimental* ONNX next to stock weights (never overwrites stock).
Stock path remains the immutable production reference.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper, shape_inference

ROOT = Path(__file__).resolve().parents[2]
STOCK = ROOT / "public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx"
OUT_DIR = ROOT / "tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28"
OUT_ONNX = OUT_DIR / "model_fp16.gathernd_rewrite.onnx"
EXPECTED_SHA = "eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516"
EXPECTED_BYTES = 98_484_532


def dims_of(vi) -> list[int | str]:
    dims: list[int | str] = []
    for d in vi.type.tensor_type.shape.dim:
        if d.dim_value:
            dims.append(int(d.dim_value))
        elif d.dim_param:
            dims.append(d.dim_param)
        else:
            dims.append("?")
    return dims


def make_const(name: str, arr: np.ndarray) -> onnx.NodeProto:
    tensor = numpy_helper.from_array(arr, name=name + "_value")
    # Prefer initializer + Identity-free: use Constant node for graph locality
    return helper.make_node(
        "Constant",
        inputs=[],
        outputs=[name],
        value=tensor,
    )


def rewrite_one(
    node: onnx.NodeProto,
    data_shape: list[int],
    uid: int,
) -> list[onnx.NodeProto]:
    """Replace one GatherND (batch_dims=2, data [1,1,H,W,C], idx [1,1,N,2])."""
    if len(data_shape) != 5:
        raise ValueError(f"expected rank-5 data, got {data_shape}")
    b0, b1, h, w, c = data_shape
    if b0 != 1 or b1 != 1:
        raise ValueError(f"expected batch [1,1,*], got {data_shape}")
    data_in, idx_in = node.input[0], node.input[1]
    out = node.output[0]
    p = f"gndrw{uid}"

    nodes: list[onnx.NodeProto] = []

    # Reshape data [1,1,H,W,C] -> [1,1,H*W,C]
    shape_data = make_const(f"{p}_shape_data", np.asarray([1, 1, h * w, c], dtype=np.int64))
    nodes.append(shape_data)
    nodes.append(
        helper.make_node(
            "Reshape",
            inputs=[data_in, f"{p}_shape_data"],
            outputs=[f"{p}_data_flat"],
            name=f"{p}_reshape_data",
        )
    )

    # indices[...,0] and indices[...,1] via Gather on last axis
    # Gather axis=-1 with scalar index requires axes Gather of indices tensor.
    idx0 = make_const(f"{p}_i0", np.asarray(0, dtype=np.int64))
    idx1 = make_const(f"{p}_i1", np.asarray(1, dtype=np.int64))
    nodes.extend([idx0, idx1])
    nodes.append(
        helper.make_node(
            "Gather",
            inputs=[idx_in, f"{p}_i0"],
            outputs=[f"{p}_y"],
            axis=3,
            name=f"{p}_gather_y",
        )
    )
    nodes.append(
        helper.make_node(
            "Gather",
            inputs=[idx_in, f"{p}_i1"],
            outputs=[f"{p}_x"],
            axis=3,
            name=f"{p}_gather_x",
        )
    )
    # y,x shapes: [1,1,N]

    w_const = make_const(f"{p}_W", np.asarray(w, dtype=np.int64))
    nodes.append(w_const)
    nodes.append(
        helper.make_node(
            "Mul",
            inputs=[f"{p}_y", f"{p}_W"],
            outputs=[f"{p}_yW"],
            name=f"{p}_mul_yW",
        )
    )
    nodes.append(
        helper.make_node(
            "Add",
            inputs=[f"{p}_yW", f"{p}_x"],
            outputs=[f"{p}_lin_b"],
            name=f"{p}_add_lin",
        )
    )

    # ONNX Gather(data, indices) expands rank by (rank(indices)-1).
    # GatherND(batch_dims=2) yields [1,1,N,C]; Gather with indices [1,1,N]
    # on axis=2 of [1,1,HW,C] would yield rank-6 [1,1,1,1,N,C].
    # Squeeze linearized indices to rank-1 [N] so Gather → [1,1,N,C].
    shape_lin = make_const(f"{p}_shape_lin", np.asarray([-1], dtype=np.int64))
    nodes.append(shape_lin)
    nodes.append(
        helper.make_node(
            "Reshape",
            inputs=[f"{p}_lin_b", f"{p}_shape_lin"],
            outputs=[f"{p}_lin"],
            name=f"{p}_reshape_lin",
        )
    )

    # Gather along flattened spatial axis → [1,1,N,C] == GatherND output
    nodes.append(
        helper.make_node(
            "Gather",
            inputs=[f"{p}_data_flat", f"{p}_lin"],
            outputs=[out],
            axis=2,
            name=f"{p}_gather_flat",
        )
    )
    return nodes


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw = STOCK.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    if len(raw) != EXPECTED_BYTES or sha != EXPECTED_SHA:
        raise SystemExit("stock integrity failed — refusing rewrite")

    model = onnx.load(str(STOCK), load_external_data=False)
    try:
        model = shape_inference.infer_shapes(model)
    except Exception as exc:  # noqa: BLE001
        print("shape_inference:", exc)

    vi = {
        v.name: v
        for v in list(model.graph.value_info)
        + list(model.graph.input)
        + list(model.graph.output)
    }

    new_nodes: list[onnx.NodeProto] = []
    replaced = 0
    for i, node in enumerate(model.graph.node):
        if node.op_type != "GatherND":
            new_nodes.append(node)
            continue
        attrs = {a.name: onnx.helper.get_attribute_value(a) for a in node.attribute}
        batch_dims = int(attrs.get("batch_dims", 0))
        if batch_dims != 2:
            raise SystemExit(f"unexpected batch_dims={batch_dims} on {node.name}")
        data_vi = vi.get(node.input[0])
        if data_vi is None:
            raise SystemExit(f"missing value_info for {node.input[0]}")
        shape = dims_of(data_vi)
        if not all(isinstance(d, int) for d in shape):
            raise SystemExit(f"non-concrete data shape {shape} on {node.name}")
        new_nodes.extend(rewrite_one(node, [int(d) for d in shape], replaced))
        replaced += 1

    del model.graph.node[:]
    model.graph.node.extend(new_nodes)

    # Clear stale value_info; re-infer
    del model.graph.value_info[:]
    try:
        model = shape_inference.infer_shapes(model)
    except Exception as exc:  # noqa: BLE001
        print("post-rewrite shape_inference:", exc)

    # Stock export also fails onnx.checker topo-sort; validate via ORT instead.
    remaining = sum(1 for n in model.graph.node if n.op_type == "GatherND")
    if remaining != 0:
        raise SystemExit(f"GatherND still present: {remaining}")

    onnx.save(model, str(OUT_ONNX))
    out_sha = hashlib.sha256(OUT_ONNX.read_bytes()).hexdigest()
    meta = {
        "stockSha256": sha,
        "rewrittenPath": str(OUT_ONNX),
        "rewrittenBytes": OUT_ONNX.stat().st_size,
        "rewrittenSha256": out_sha,
        "gatherNdReplaced": replaced,
        "gatherNdRemaining": remaining,
        "scatterNdUntouched": sum(1 for n in model.graph.node if n.op_type == "ScatterND"),
        "note": "Experimental only — must not replace public/models/.../model_fp16.onnx",
    }
    (OUT_DIR / "rewrite-meta.json").write_text(
        __import__("json").dumps(meta, indent=2), encoding="utf-8"
    )
    print(__import__("json").dumps(meta, indent=2))


if __name__ == "__main__":
    main()
