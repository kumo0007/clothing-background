#!/usr/bin/env python3
"""Static audit of GatherND → Gather rewrite: shapes, index linearization, bounds.

Does not modify production weights. Writes audit-rewrite.json.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
import onnx
from onnx import numpy_helper, shape_inference

ROOT = Path(__file__).resolve().parents[2]
STOCK = ROOT / "public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx"
REWRITE = ROOT / "tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/model_fp16.gathernd_rewrite.onnx"
OUT = ROOT / "tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/audit-rewrite.json"
EXPECTED_STOCK_SHA = "eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516"
EXPECTED_REWRITE_SHA = "7f0dfdabbb7a0c588bd4a1e155bb291b470cbd2030af7779fb47ec8514499f8e"


def dims_of(vi) -> list:
    out = []
    for d in vi.type.tensor_type.shape.dim:
        if d.dim_value:
            out.append(int(d.dim_value))
        elif d.dim_param:
            out.append(d.dim_param)
        else:
            out.append("?")
    return out


def gathernd_reference(
    data: np.ndarray, indices: np.ndarray, batch_dims: int = 2
) -> np.ndarray:
    """Reference GatherND for batch_dims=2, indices last dim = 2 (y,x)."""
    assert batch_dims == 2
    assert data.ndim == 5 and indices.ndim == 4 and indices.shape[-1] == 2
    b0, b1, h, w, c = data.shape
    n = indices.shape[2]
    out = np.empty((b0, b1, n, c), dtype=data.dtype)
    for i0 in range(b0):
        for i1 in range(b1):
            for k in range(n):
                y = int(indices[i0, i1, k, 0])
                x = int(indices[i0, i1, k, 1])
                out[i0, i1, k, :] = data[i0, i1, y, x, :]
    return out


def rewrite_numpy(data: np.ndarray, indices: np.ndarray) -> np.ndarray:
    """Mirror rewrite_gathernd.py linearization."""
    b0, b1, h, w, c = data.shape
    flat = data.reshape(b0, b1, h * w, c)
    y = indices[..., 0]
    x = indices[..., 1]
    lin = (y * w + x).reshape(-1)
    # Gather along axis=2 with 1-D indices → [b0,b1,N,c]
    return flat[:, :, lin, :]


def main() -> None:
    findings: list[dict] = []
    stock_raw = STOCK.read_bytes()
    stock_sha = hashlib.sha256(stock_raw).hexdigest()
    if stock_sha != EXPECTED_STOCK_SHA:
        findings.append(
            {
                "severity": "blocker",
                "id": "stock-sha",
                "detail": f"stock sha drifted {stock_sha}",
            }
        )

    rewrite_raw = REWRITE.read_bytes()
    rewrite_sha = hashlib.sha256(rewrite_raw).hexdigest()
    if rewrite_sha != EXPECTED_REWRITE_SHA:
        findings.append(
            {
                "severity": "warn",
                "id": "rewrite-sha-drift",
                "detail": f"rewrite sha {rewrite_sha} != recorded {EXPECTED_REWRITE_SHA}",
            }
        )

    model = onnx.load(str(STOCK), load_external_data=False)
    try:
        model = shape_inference.infer_shapes(model)
    except Exception as exc:  # noqa: BLE001
        findings.append(
            {"severity": "info", "id": "shape-infer-stock", "detail": str(exc)}
        )

    vi = {
        v.name: v
        for v in list(model.graph.value_info)
        + list(model.graph.input)
        + list(model.graph.output)
    }

    patterns = Counter()
    oob_risks = []
    shape_ok = 0
    for node in model.graph.node:
        if node.op_type != "GatherND":
            continue
        attrs = {a.name: onnx.helper.get_attribute_value(a) for a in node.attribute}
        bd = int(attrs.get("batch_dims", 0))
        data_vi = vi.get(node.input[0])
        idx_vi = vi.get(node.input[1])
        if data_vi is None or idx_vi is None:
            findings.append(
                {
                    "severity": "blocker",
                    "id": "missing-vi",
                    "detail": node.name,
                }
            )
            continue
        ds = dims_of(data_vi)
        ix = dims_of(idx_vi)
        patterns[(str(ds), str(ix), bd)] += 1
        if bd != 2 or len(ds) != 5 or not all(isinstance(d, int) for d in ds):
            findings.append(
                {
                    "severity": "blocker",
                    "id": "unsupported-pattern",
                    "detail": f"{node.name} data={ds} idx={ix} bd={bd}",
                }
            )
            continue
        b0, b1, h, w, c = ds  # type: ignore[misc]
        if b0 != 1 or b1 != 1:
            findings.append(
                {
                    "severity": "blocker",
                    "id": "batch-not-1x1",
                    "detail": f"{node.name} {ds}",
                }
            )
            continue
        # Index bounds: runtime indices must be in [0,H) x [0,W). Deformable
        # sampling typically clamps; rewrite does NOT add Clamp — same as GatherND
        # (OOB is undefined / EP-dependent). Record as residual risk.
        oob_risks.append(
            {
                "node": node.name,
                "H": h,
                "W": w,
                "C": c,
                "N": ix[2] if len(ix) > 2 and isinstance(ix[2], int) else "?",
                "note": "Rewrite inherits GatherND OOB semantics; no added Clamp",
            }
        )
        shape_ok += 1

    # Numeric identity of linearization vs GatherND on synthetic in-bounds indices
    numeric_cases = []
    rng = np.random.default_rng(0)
    for h, w, n in [(18, 18, 256), (66, 66, 4096), (134, 134, 1000)]:
        data = rng.standard_normal((1, 1, h, w, 64)).astype(np.float16)
        ys = rng.integers(0, h, size=(1, 1, n), dtype=np.int64)
        xs = rng.integers(0, w, size=(1, 1, n), dtype=np.int64)
        idx = np.stack([ys, xs], axis=-1)
        ref = gathernd_reference(data.astype(np.float32), idx)
        hyp = rewrite_numpy(data.astype(np.float32), idx)
        max_diff = float(np.max(np.abs(ref - hyp)))
        numeric_cases.append(
            {
                "H": h,
                "W": w,
                "N": n,
                "maxAbsDiff": max_diff,
                "exact": max_diff == 0.0,
            }
        )
        if max_diff != 0.0:
            findings.append(
                {
                    "severity": "blocker",
                    "id": "linearize-mismatch",
                    "detail": f"H={h} W={w} N={n} maxDiff={max_diff}",
                }
            )

    # Boundary indices 0 and H-1 / W-1
    h, w, n = 18, 18, 64
    data = rng.standard_normal((1, 1, h, w, 8)).astype(np.float32)
    ys = np.array([[[0] * (n // 2) + [h - 1] * (n // 2)]], dtype=np.int64)
    xs = np.array([[[0] * (n // 2) + [w - 1] * (n // 2)]], dtype=np.int64)
    idx = np.stack([ys, xs], axis=-1)
    boundary_diff = float(
        np.max(
            np.abs(
                gathernd_reference(data, idx) - rewrite_numpy(data, idx)
            )
        )
    )
    numeric_cases.append(
        {
            "case": "boundary-corners",
            "maxAbsDiff": boundary_diff,
            "exact": boundary_diff == 0.0,
        }
    )

    # Rewrite graph checks
    rw = onnx.load(str(REWRITE), load_external_data=False)
    gather_nd_left = sum(1 for n in rw.graph.node if n.op_type == "GatherND")
    scatter = sum(1 for n in rw.graph.node if n.op_type == "ScatterND")
    gndrw = sum(1 for n in rw.graph.node if n.name.startswith("gndrw"))
    if gather_nd_left != 0:
        findings.append(
            {
                "severity": "blocker",
                "id": "gathernd-remaining",
                "detail": str(gather_nd_left),
            }
        )

    # Batch behavior: rewrite hardcodes batch [1,1] from concrete shapes —
    # dynamic batch >1 would be incorrect. Production BiRefNet always N=1.
    findings.append(
        {
            "severity": "info",
            "id": "batch-assumption",
            "detail": "Rewrite embeds H*W and assumes leading batch dims are 1,1 (matches BiRefNet single-image NCHW).",
        }
    )
    findings.append(
        {
            "severity": "info",
            "id": "oob-semantics",
            "detail": "No Clamp added; out-of-range deformable indices share Gather/GatherND EP undefined behavior. In-bounds deform sampling verified bit-exact on synthetic cases.",
        }
    )

    blockers = [f for f in findings if f["severity"] == "blocker"]
    report = {
        "ok": len(blockers) == 0,
        "stockSha256": stock_sha,
        "rewriteSha256": rewrite_sha,
        "gatherNdPatterns": {str(k): v for k, v in patterns.most_common()},
        "gatherNdConcreteOk": shape_ok,
        "gatherNdRemainingInRewrite": gather_nd_left,
        "scatterNdUntouched": scatter,
        "rewriteHelperNodesNamedGndrw": gndrw,
        "numericLinearization": numeric_cases,
        "oobRiskSample": oob_risks[:5],
        "oobRiskCount": len(oob_risks),
        "findings": findings,
        "coordinateOrder": "indices[...,0]=y (row), indices[...,1]=x (col); lin=y*W+x matches row-major flatten of [H,W]",
    }
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"ok": report["ok"], "blockers": len(blockers)}, indent=2))
    if not report["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
