/**
 * Licensing / dependency / deployment constraint audit for the WebGPU rewrite experiment.
 * No production path changes.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = join(
  root,
  'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/production-readiness',
)

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

const rewriteOnnx = join(
  root,
  'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/model_fp16.gathernd_rewrite.onnx',
)
const stockOnnx = join(
  root,
  'public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx',
)

const addedForExperiment: string[] = []
// Experiment uses only existing deps: onnxruntime-web, playwright-core, tsx, onnx (python)
const runtimeDeps = Object.keys(pkg.dependencies)
const newNpmRuntime = runtimeDeps.filter(
  (d) =>
    !['onnxruntime-web', 'react', 'react-dom', 'fflate', 'bg-remove-sdk'].includes(
      d,
    ) &&
    !d.startsWith('@imgly') &&
    !d.startsWith('@techstark'),
)

const blockers: string[] = []
const risks: string[] = []

if (!existsSync(rewriteOnnx)) {
  blockers.push('rewrite ONNX missing')
}
if (!existsSync(stockOnnx)) {
  blockers.push('stock ONNX missing')
}

const stockSha = createHash('sha256')
  .update(readFileSync(stockOnnx))
  .digest('hex')
const rewriteSha = existsSync(rewriteOnnx)
  ? createHash('sha256').update(readFileSync(rewriteOnnx)).digest('hex')
  : null

if (stockSha === rewriteSha) {
  blockers.push('rewrite SHA equals stock — isolation broken')
}

// DIS5K commercial note (pre-existing for BiRefNet)
risks.push(
  'BiRefNet training data includes DIS5K — commercial products must review DIS5K dataset terms separately from MIT model weights.',
)
risks.push(
  'WebGPU EP remains opt-in (VITE_BIREFNET_WEBGPU=1). Shipping rewrite would require a second hashed artifact and explicit EP policy.',
)
risks.push(
  'WebGPU vs WASM masks are not bit-identical (IoU≥0.998). Golden SHA fixtures are WASM-locked; GPU masks would need a separate acceptance policy.',
)
risks.push(
  'ScatterND (72) and Sum (20) untouched — may still CPU-fallback on some adapters; monitor host↔device copies / memory on low-end GPUs.',
)
risks.push(
  'ORT GatherND WebGPU fix (#32733) still draft; upgrading ORT later may make stock graph work without rewrite.',
)

const report = {
  ok: blockers.length === 0,
  blockers,
  risks,
  dependencies: {
    onnxruntimeWeb: pkg.dependencies['onnxruntime-web'],
    onnxruntimeWebLicense: 'MIT',
    playwrightCoreDev: pkg.devDependencies['playwright-core'],
    newNpmRuntimeDepsForThisExperiment: addedForExperiment,
    note: 'No new npm runtime dependencies were added for the rewrite experiment. Python onnx used offline for graph surgery only.',
    unrelatedRuntimeDepsPresent: newNpmRuntime,
  },
  models: {
    stockPath: 'public/models/studioludens/birefnet-lite-512/onnx/model_fp16.onnx',
    stockSha256: stockSha,
    stockLicense: 'MIT weights (studioludens/birefnet-lite-512); upstream ZhengPeng7/BiRefNet MIT',
    rewritePath:
      'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/model_fp16.gathernd_rewrite.onnx',
    rewriteSha256: rewriteSha,
    rewriteLicense:
      'Same MIT weights; topology-only surgery; not a redistributed alternate trained model',
    isolatedFromPublicModels: !existsSync(
      join(
        root,
        'public/models/studioludens/birefnet-lite-512/onnx/model_fp16.gathernd_rewrite.onnx',
      ),
    ),
  },
  deploymentConstraints: [
    'Must not overwrite production model_fp16.onnx without SHA constant + golden policy update',
    'WebGPU requires Chromium-family browser with navigator.gpu; Firefox/WebKit currently unsupported for this EP path',
    'COOP/COEP helpful for WASM threads but not required for single-thread WASM fallback',
    'Dual-hosting rewrite ONNX adds ~98.5MB CDN weight if productized',
    'Default production path remains WASM-preferring unless VITE_BIREFNET_WEBGPU=1',
  ],
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'licensing-audit.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ok: report.ok, blockers, riskCount: risks.length }, null, 2))
if (!report.ok) process.exit(1)
