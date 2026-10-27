/**
 * Guard: experimental rewrite must never silently replace the production model.
 * Fails if stock SHA/bytes drift, or if a rewrite artifact sits at the prod path.
 *
 * Run: npx tsx experiments/birefnet-webgpu-rewrite/assert_prod_model_untouched.mts
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_PATH,
  BIREFNET_ONNX_FP16_SHA256,
} from '../../src/lib/mask/birefNet/constants'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const stockPath = join(
  root,
  'public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx',
)
const rewriteMeta = join(
  root,
  'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/rewrite-meta.json',
)
const rewriteOnnx = join(
  root,
  'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/model_fp16.gathernd_rewrite.onnx',
)

const failures: string[] = []

function sha256(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex')
}

// 1) Production constant path must remain the stock mirror URL
if (BIREFNET_ONNX_FP16_PATH !== '/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx') {
  failures.push(`constants path drifted: ${BIREFNET_ONNX_FP16_PATH}`)
}
if (BIREFNET_ONNX_FP16_BYTES !== 98_484_532) {
  failures.push(`constants bytes drifted: ${BIREFNET_ONNX_FP16_BYTES}`)
}
if (
  BIREFNET_ONNX_FP16_SHA256 !==
  'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516'
) {
  failures.push(`constants sha drifted: ${BIREFNET_ONNX_FP16_SHA256}`)
}

// 2) Stock file on disk matches trusted LFS oid
if (!existsSync(stockPath)) {
  failures.push(`missing stock at ${stockPath}`)
} else {
  const bytes = readFileSync(stockPath)
  const sha = sha256(bytes)
  if (bytes.length !== BIREFNET_ONNX_FP16_BYTES) {
    failures.push(
      `stock size ${bytes.length} != expected ${BIREFNET_ONNX_FP16_BYTES}`,
    )
  }
  if (sha !== BIREFNET_ONNX_FP16_SHA256) {
    failures.push(`stock sha ${sha} != expected ${BIREFNET_ONNX_FP16_SHA256}`)
  }
  // Rewrite must differ from stock if present
  if (existsSync(rewriteOnnx)) {
    const rSha = sha256(readFileSync(rewriteOnnx))
    if (rSha === sha) {
      failures.push('rewrite file SHA equals stock — unexpected')
    }
    if (statSync(rewriteOnnx).size === BIREFNET_ONNX_FP16_BYTES) {
      // size may differ; only flag if identical bytes
    }
  }
}

// 3) No gathernd_rewrite artifact under public/models production tree
const publicOnnxDir = join(
  root,
  'public/models/studioludens/birefnet-lite-512/onnx',
)
if (existsSync(publicOnnxDir)) {
  for (const name of readdirSync(publicOnnxDir)) {
    if (/gathernd|rewrite|webgpu/i.test(name)) {
      failures.push(
        `experimental artifact in production onnx dir: ${name}`,
      )
    }
  }
}

// 4) Production sources must not reference rewrite paths (string scan)
const prodScanRoots = [
  join(root, 'src/lib/mask/birefNet/session.ts'),
  join(root, 'src/lib/mask/birefNet/constants.ts'),
  join(root, 'src/lib/mask/birefNet/index.ts'),
  join(root, 'src/App.tsx'),
]
for (const file of prodScanRoots) {
  if (!existsSync(file)) continue
  const src = readFileSync(file, 'utf8')
  if (/gathernd_rewrite|webgpu-rewrite|birefnet-webgpu-rewrite/i.test(src)) {
    failures.push(`${file} references experimental rewrite path`)
  }
}

// 4b) Default WebGPU preference remains opt-in (not on by default)
{
  const sessionSrc = readFileSync(
    join(root, 'src/lib/mask/birefNet/session.ts'),
    'utf8',
  )
  if (!/VITE_BIREFNET_WEBGPU\s*===\s*['"]1['"]/.test(sessionSrc)) {
    failures.push('session.ts no longer gates WebGPU behind VITE_BIREFNET_WEBGPU=1')
  }
  // Rewrite ONNX must not be the resolveBirefNetModelUrl target
  if (/gathernd_rewrite/.test(sessionSrc)) {
    failures.push('session.ts resolves rewrite ONNX')
  }
}

// 5) Meta documents isolation
if (existsSync(rewriteMeta)) {
  const meta = JSON.parse(readFileSync(rewriteMeta, 'utf8')) as {
    stockSha256?: string
    note?: string
  }
  if (meta.stockSha256 !== BIREFNET_ONNX_FP16_SHA256) {
    failures.push('rewrite-meta stockSha256 mismatch')
  }
  if (!meta.note || !/must not replace/i.test(meta.note)) {
    failures.push('rewrite-meta missing isolation note')
  }
}

const report = {
  ok: failures.length === 0,
  failures,
  stockPath,
  productionConstantPath: BIREFNET_ONNX_FP16_PATH,
  stockSha256: existsSync(stockPath)
    ? sha256(readFileSync(stockPath))
    : null,
}

console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exit(1)
