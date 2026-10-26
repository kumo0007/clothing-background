/**
 * Emit a patched bg-remove-sdk worker that loads RMBG-1.4 from same-origin
 * `/models/…` (see fetchRmbgBrowserWeights.mts) instead of huggingface.co.
 *
 * Safari iOS repeatedly failed HF CDN redirects with opaque `Load failed`
 * even after CSP allowlists; same-origin static weights avoid that path.
 *
 * Usage: npx tsx scripts/emitBgRemoveWorker.mts
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const sdkWorker = require.resolve('bg-remove-sdk/worker')
const outDir = join(root, 'public')
const outFile = join(outDir, 'bg-remove-worker.js')

const MARKER = 'mv.allowLocalModels = !1'
const PATCH = [
  'mv.allowLocalModels = !0',
  'mv.allowRemoteModels = !1',
  'mv.localModelPath = "/models/"',
].join(';')

function patchWorkerSource(source: string): string {
  if (!source.includes(MARKER)) {
    throw new Error(
      `bg-remove-sdk worker missing expected marker "${MARKER}" — SDK upgrade broke the patch`,
    )
  }
  if ((source.match(new RegExp(MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length !== 1) {
    throw new Error('Expected exactly one allowLocalModels=!1 assignment to patch')
  }
  return source.replace(MARKER, PATCH)
}

function main(): void {
  mkdirSync(outDir, { recursive: true })
  const raw = readFileSync(sdkWorker, 'utf8')
  const patched = patchWorkerSource(raw)
  writeFileSync(outFile, patched, 'utf8')
  // Keep a copy of the unpatched worker next to it for audits (not served as default).
  copyFileSync(sdkWorker, join(outDir, 'bg-remove-worker.upstream.js'))
  console.log('Wrote', outFile)
  console.log('Patched: allowLocalModels=true, allowRemoteModels=false, localModelPath=/models/')
}

main()
