/**
 * Validate local BiRefNet FP16 ONNX without re-downloading.
 * Run: npx tsx scripts/validateBirefNetWeights.mts
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// onnxruntime-node DLLs fail to load on some Windows hosts; use the same
// onnxruntime-web WASM stack as the browser path for structural validation.
import * as ort from 'onnxruntime-web'
import {
  BIREFNET_HF_REPO,
  BIREFNET_INPUT_NAME,
  BIREFNET_INPUT_SIZE,
  BIREFNET_ONNX_FP16_BYTES,
  BIREFNET_ONNX_FP16_PATH,
  BIREFNET_ONNX_FP16_SHA256,
  BIREFNET_OUTPUT_NAME,
} from '../src/lib/mask/birefNet/constants'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const diskPath = join(
  root,
  'public',
  'models',
  BIREFNET_HF_REPO,
  'onnx',
  'model_fp16.onnx',
)
const outDir = join(root, 'tmp-model-eval', 'birefnet-weight-validation')

type Finding = { ok: boolean; name: string; detail: string }

async function main() {
  const findings: Finding[] = []
  mkdirSync(outDir, { recursive: true })

  findings.push({
    ok: true,
    name: 'app_public_url',
    detail: BIREFNET_ONNX_FP16_PATH,
  })
  findings.push({
    ok: existsSync(diskPath),
    name: 'disk_path',
    detail: diskPath,
  })
  if (!existsSync(diskPath)) {
    writeReport(findings, null)
    process.exit(1)
  }

  const size = statSync(diskPath).size
  findings.push({
    ok: size === BIREFNET_ONNX_FP16_BYTES,
    name: 'exact_size',
    detail: `${size} (expected ${BIREFNET_ONNX_FP16_BYTES} from HF LFS pointer)`,
  })

  const sha = createHash('sha256').update(readFileSync(diskPath)).digest('hex')
  findings.push({
    ok: sha === BIREFNET_ONNX_FP16_SHA256,
    name: 'sha256_vs_lfs_pointer',
    detail: `got ${sha}; trusted LFS oid ${BIREFNET_ONNX_FP16_SHA256} (huggingface.co/.../raw/main/onnx/model_fp16.onnx)`,
  })

  // Magic / protobuf-ish: ONNX files typically start with field tags; ensure not HTML/LFS pointer text.
  const head = readFileSync(diskPath).subarray(0, 64)
  const asText = head.toString('utf8')
  const looksLikeLfsPointer = asText.includes('git-lfs') || asText.includes('oid sha256')
  const looksLikeHtml = asText.trimStart().startsWith('<!')
  findings.push({
    ok: !looksLikeLfsPointer && !looksLikeHtml && size > 1_000_000,
    name: 'not_text_stub',
    detail: looksLikeLfsPointer
      ? 'file looks like a Git LFS pointer'
      : looksLikeHtml
        ? 'file looks like HTML'
        : 'binary payload present',
  })

  let sessionMeta: Record<string, unknown> | null = null
  try {
    const t0 = Date.now()
    const session = await ort.InferenceSession.create(diskPath, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'basic',
    })
    const loadMs = Date.now() - t0
    const inputs = session.inputNames.map((name) => ({
      name,
      meta: (session as { inputMetadata?: Record<string, unknown> }).inputMetadata?.[
        name
      ],
    }))
    const outputs = session.outputNames.map((name) => ({
      name,
      meta: (session as { outputMetadata?: Record<string, unknown> })
        .outputMetadata?.[name],
    }))
    findings.push({
      ok: session.inputNames.includes(BIREFNET_INPUT_NAME),
      name: 'input_name',
      detail: `names=${session.inputNames.join(',')} expected=${BIREFNET_INPUT_NAME}`,
    })
    findings.push({
      ok: session.outputNames.includes(BIREFNET_OUTPUT_NAME),
      name: 'output_name',
      detail: `names=${session.outputNames.join(',')} expected=${BIREFNET_OUTPUT_NAME}`,
    })

    // Smoke inference: zeros tensor → finite logits of expected length.
    const zeros = new Float32Array(1 * 3 * BIREFNET_INPUT_SIZE * BIREFNET_INPUT_SIZE)
    const tensor = new ort.Tensor('float32', zeros, [
      1,
      3,
      BIREFNET_INPUT_SIZE,
      BIREFNET_INPUT_SIZE,
    ])
    const inferT0 = Date.now()
    const out = await session.run({ [BIREFNET_INPUT_NAME]: tensor })
    const inferMs = Date.now() - inferT0
    const outT = out[BIREFNET_OUTPUT_NAME]!
    const data = outT.data as Float32Array
    let nonFinite = 0
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < data.length; i += 1) {
      const v = data[i]!
      if (!Number.isFinite(v)) nonFinite += 1
      else {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    findings.push({
      ok: nonFinite === 0 && data.length === BIREFNET_INPUT_SIZE * BIREFNET_INPUT_SIZE,
      name: 'smoke_infer_cpu',
      detail: `len=${data.length} dims=${JSON.stringify(outT.dims)} nonFinite=${nonFinite} min=${min} max=${max} loadMs=${loadMs} inferMs=${inferMs}`,
    })

    sessionMeta = {
      loadMs,
      inferMs,
      inputs,
      outputs,
      dims: outT.dims,
    }
  } catch (err) {
    findings.push({
      ok: false,
      name: 'onnxruntime_node_load',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  const allOk = findings.every((f) => f.ok)
  writeReport(findings, sessionMeta)
  console.log(JSON.stringify({ allOk, findings, sessionMeta }, null, 2))
  process.exit(allOk ? 0 : 1)
}

function writeReport(
  findings: Finding[],
  sessionMeta: Record<string, unknown> | null,
) {
  const body = {
    generatedAt: new Date().toISOString(),
    diskPath,
    appUrl: BIREFNET_ONNX_FP16_PATH,
    trustedLfs: {
      bytes: BIREFNET_ONNX_FP16_BYTES,
      sha256: BIREFNET_ONNX_FP16_SHA256,
      source:
        'https://huggingface.co/studioludens/birefnet-lite-512/raw/main/onnx/model_fp16.onnx',
    },
    note: '.mirror-meta.json is download metadata only; integrity is size+SHA-256+ORT load.',
    findings,
    sessionMeta,
  }
  writeFileSync(join(outDir, 'validation.json'), JSON.stringify(body, null, 2))
  writeFileSync(
    join(outDir, 'REPORT.md'),
    [
      '# BiRefNet weight validation',
      '',
      `| Check | OK | Detail |`,
      `| --- | --- | --- |`,
      ...findings.map(
        (f) => `| ${f.name} | ${f.ok ? 'yes' : 'NO'} | ${f.detail.replace(/\|/g, '/')} |`,
      ),
      '',
    ].join('\n'),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
