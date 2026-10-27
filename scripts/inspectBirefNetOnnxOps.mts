/**
 * Isolated: scan pinned BiRefNet FP16 ONNX for ops relevant to EP support.
 * Does not touch production. Run: npx tsx scripts/inspectBirefNetOnnxOps.mts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_SHA256,
} from '../src/lib/mask/birefNet/constants'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const weightsPath = join(
  root,
  'public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx',
)
const outDir = join(root, 'tmp-model-eval/birefnet-hw-accel-2026-10-28')

/** Op type strings that commonly gate WebGPU / WebGL support. */
const OP_MARKERS = [
  'GatherND',
  'ScatterND',
  'Gather',
  'Split',
  'Concat',
  'Sum',
  'DeformConv',
  'GridSample',
  'NonMaxSuppression',
  'TopK',
  'Einsum',
  'LayerNormalization',
  'InstanceNormalization',
  'GroupNormalization',
  'Resize',
  'Conv',
  'ConvTranspose',
  'MatMul',
  'Gemm',
  'Softmax',
  'Sigmoid',
  'Relu',
  'Gelu',
  'Mul',
  'Add',
  'Sub',
  'Div',
  'Cast',
  'Reshape',
  'Transpose',
  'Squeeze',
  'Unsqueeze',
  'Expand',
  'Where',
  'ConstantOfShape',
  'Shape',
  'Slice',
  'Pad',
  'ReduceMean',
  'ReduceSum',
  'ReduceMax',
] as const

function countAsciiOccurrences(buf: Buffer, ascii: string): number {
  const needle = Buffer.from(ascii, 'ascii')
  let count = 0
  let idx = 0
  while (idx < buf.length) {
    const found = buf.indexOf(needle, idx)
    if (found < 0) break
    count += 1
    idx = found + needle.length
  }
  return count
}

function main() {
  mkdirSync(outDir, { recursive: true })
  const buf = readFileSync(weightsPath)
  const sha = createHash('sha256').update(buf).digest('hex')
  if (buf.length !== BIREFNET_ONNX_FP16_BYTES || sha !== BIREFNET_ONNX_FP16_SHA256) {
    throw new Error('Pinned BiRefNet weights integrity failed')
  }

  const counts: Record<string, number> = {}
  for (const op of OP_MARKERS) {
    counts[op] = countAsciiOccurrences(buf, op)
  }

  // Heuristic: FLOAT16 / FLOAT protobuf type tags appear as type descriptors.
  const float16Hits = countAsciiOccurrences(buf, 'FLOAT16')
  const floatHits = countAsciiOccurrences(buf, 'FLOAT')

  const report = {
    generatedAt: new Date().toISOString(),
    weights: {
      path: weightsPath,
      bytes: buf.length,
      sha256: sha,
      verified: true,
    },
    note: 'ASCII marker counts in the ONNX protobuf (approximate op-type frequency; not a full graph parse).',
    opMarkerCounts: counts,
    dtypeHints: { FLOAT16: float16Hits, FLOAT: floatHits },
    webgpuRiskFlags: {
      gatherNdCount: counts.GatherND,
      scatterNdCount: counts.ScatterND,
      highAritySplitHint: counts.Split,
      knownIssue:
        'BiRefNet lite FP16 uses many rank-5 GatherND nodes (deformable attention). ORT WebGPU GatherND computeSliceOffsets fails Tint validation (ORT #32731); stock checkpoint yields degenerate logits on WebGPU under onnxruntime-web 1.21.',
    },
    candidates: {
      wasm: {
        supportedInOrtWeb121: true,
        stockModelCompatible: true,
        productionDefault: true,
      },
      webgpu: {
        supportedInOrtWeb121: true,
        stockModelCompatible:
          'session may create; inference quality broken on this checkpoint (GatherND)',
        requiresGraphRewriteOrOrtFix: true,
      },
      webgl: {
        supportedInOrtWeb121: true,
        stockModelCompatible: 'measure in isolated harness — often incomplete op coverage',
      },
    },
  }

  writeFileSync(join(outDir, 'onnx-ops-inspect.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

main()
