/**
 * Commercial release gate for RMBG-1.4 weights.
 *
 * Default: print status; exit 0 for honest UNRESOLVED + NOT READY report;
 * exit 1 for missing/incomplete bookkeeping.
 *
 * `--require-commercial`: exit 0 only when:
 *   - Status RESOLVED + A4 + non-placeholder Evidence artifact
 *   - Owner attestation present (non-placeholder)
 *   - Artifact resolves under tmp-release-validation/commercial-evidence/
 *     (nonempty; no traversal/symlink escape)
 *
 * Exit 0 means **evidence_present_pending_review** — NEVER legally approved.
 *
 * Run: npx tsx scripts/assertCommercialReleaseGate.mts [--require-commercial]
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePermittedEvidencePath } from '../src/lib/release/commercialEvidencePath'
import {
  COMMERCIAL_GATE_LEGAL_DISCLAIMER,
  describeCommercialGateOutcome,
  hasCommercialEvidenceMarkers,
  hasOwnerAttestation,
  isCommercialBookkeepingComplete,
  readCommercialLicenseStatus,
  readEvidenceArtifactValue,
} from '../src/lib/release/commercialLicenseStatus'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checklistPath = join(
  root,
  'tmp-release-validation',
  'BRIA_COMMERCIAL_LICENSE_CHECKLIST.md',
)
const finalReportPath = join(
  root,
  'tmp-release-validation',
  'FINAL_PRODUCTION_READINESS_REPORT.md',
)

function main(): void {
  const requireCommercial = process.argv.includes('--require-commercial')
  // Ignore unknown flags — they must not bypass the gate.
  const unknownArgs = process.argv
    .slice(2)
    .filter((a) => a !== '--require-commercial' && a.startsWith('-'))
  if (unknownArgs.length > 0) {
    console.warn(
      'Commercial license gate: ignoring unknown flags:',
      unknownArgs.join(', '),
    )
  }

  if (!existsSync(checklistPath)) {
    console.error(
      'Commercial license gate: checklist missing at',
      checklistPath,
    )
    process.exit(1)
  }

  const checklist = readFileSync(checklistPath, 'utf8')
  const status = readCommercialLicenseStatus(checklist)
  const hasEvidence = hasCommercialEvidenceMarkers(checklist)
  const hasAttestation = hasOwnerAttestation(checklist)
  const artifact = readEvidenceArtifactValue(checklist)

  let evidencePathOk = false
  let evidencePathReason = 'not evaluated'
  if (artifact) {
    const resolved = resolvePermittedEvidencePath(artifact, root)
    evidencePathOk = resolved.ok
    evidencePathReason = resolved.ok
      ? 'path under commercial-evidence/ (bookkeeping only)'
      : resolved.reason
  }

  const outcome = describeCommercialGateOutcome({
    status,
    hasAttestation,
    evidencePathOk,
  })

  console.log('Commercial licensing gate (RMBG-1.4 weights)')
  console.log('  checklist:', checklistPath)
  console.log('  bookkeeping status:', status)
  console.log(
    '  evidence markers (A4 + artifact text):',
    hasEvidence ? 'present' : 'absent',
  )
  console.log(
    '  owner attestation:',
    hasAttestation ? 'present' : 'absent',
  )
  console.log('  evidence path check:', evidencePathReason)
  console.log('  gate outcome:', outcome)
  console.log('  limitation:', COMMERCIAL_GATE_LEGAL_DISCLAIMER)
  console.log('  note: technical verify:release ≠ commercial approval')
  console.log(
    '  note: no alternate npm script grants commercial approval without --require-commercial',
  )

  if (existsSync(finalReportPath)) {
    const report = readFileSync(finalReportPath, 'utf8')
    const notReady = /NOT READY FOR COMMERCIAL PRODUCTION/i.test(report)
    console.log(
      '  final report commercial verdict present:',
      notReady
        ? 'NOT READY (expected while unresolved/incomplete/pending review)'
        : 'check manually',
    )
    if (
      (status === 'unresolved' ||
        status === 'incomplete' ||
        status === 'missing' ||
        outcome === 'blocked') &&
      requireCommercial &&
      !notReady
    ) {
      console.error(
        'Commercial license gate: commercial permission is not cleared but final report no longer says NOT READY FOR COMMERCIAL PRODUCTION.',
      )
      process.exit(1)
    }
    if (
      (status === 'unresolved' ||
        status === 'incomplete' ||
        status === 'missing') &&
      !requireCommercial &&
      !notReady
    ) {
      console.error(
        'Commercial license gate: commercial permission is not cleared but final report no longer says NOT READY FOR COMMERCIAL PRODUCTION.',
      )
      process.exit(1)
    }
  } else if (requireCommercial) {
    console.error(
      'Commercial license gate: FINAL_PRODUCTION_READINESS_REPORT.md missing.',
    )
    process.exit(1)
  }

  if (status === 'missing') {
    console.error(
      'Commercial license gate: cannot parse **Status:** from checklist (fail closed).',
    )
    process.exit(1)
  }

  if (status === 'incomplete') {
    console.error(
      'Commercial license gate: Status claims RESOLVED but both evidence markers are required (A4 [x] AND non-placeholder **Evidence artifact:**). Fail closed.',
    )
    process.exit(1)
  }

  if (requireCommercial) {
    if (!isCommercialBookkeepingComplete(status)) {
      console.error(
        `Commercial license gate: BLOCKED — bookkeeping status=${status}.`,
      )
      process.exit(1)
    }
    if (!hasAttestation) {
      console.error(
        'Commercial license gate: BLOCKED — **Owner attestation:** missing or placeholder. Human review step required.',
      )
      process.exit(1)
    }
    if (!evidencePathOk) {
      console.error(
        'Commercial license gate: BLOCKED — evidence path rejected:',
        evidencePathReason,
      )
      process.exit(1)
    }
    if (outcome !== 'evidence_present_pending_review') {
      console.error(
        'Commercial license gate: BLOCKED — outcome=',
        outcome,
      )
      process.exit(1)
    }

    console.log(
      '  result: EVIDENCE_PRESENT_PENDING_REVIEW — HUMAN_REVIEW_REQUIRED (counsel must confirm agreement scope). NOT commercially approved.',
    )
    console.log('  ', COMMERCIAL_GATE_LEGAL_DISCLAIMER)
    process.exit(0)
  }

  if (status === 'unresolved') {
    console.log(
      '  result: technical work may continue; commercial ship remains blocked.',
    )
  } else if (status === 'resolved') {
    console.log(
      '  result: bookkeeping markers present — still blocked for ship until owner attestation + permitted evidence path + counsel review.',
    )
  }
}

main()
