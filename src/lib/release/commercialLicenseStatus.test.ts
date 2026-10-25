import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COMMERCIAL_GATE_LEGAL_DISCLAIMER,
  describeCommercialGateOutcome,
  hasCommercialEvidenceMarkers,
  hasOwnerAttestation,
  isA4EvidenceChecked,
  isCommercialBookkeepingComplete,
  isCommercialLicenseCleared,
  isPlaceholderEvidenceArtifact,
  isPlaceholderOwnerAttestation,
  readCommercialLicenseStatus,
  readEvidenceArtifactValue,
  readOwnerAttestationValue,
} from './commercialLicenseStatus'

const root = process.cwd()

const bookkeepingOk = [
  '**Status:** **RESOLVED** — agreement filed',
  '**Evidence artifact:** bria-rmbg-1.4-signed.pdf',
  '**Owner attestation:** Jane Owner, 2026-10-26 — reviewed grant for RMBG-1.4',
  '| A4 | Signed PDF or DocuSign (or equivalent) retained | [x] | path |',
].join('\n')

describe('commercial license status (separate from technical tests)', () => {
  it('parses UNRESOLVED, missing, and fail-closed incomplete RESOLVED', () => {
    expect(
      readCommercialLicenseStatus(
        '**Status:** **UNRESOLVED** — no agreement\n',
      ),
    ).toBe('unresolved')
    expect(readCommercialLicenseStatus('# No status line\n')).toBe('missing')
    expect(readCommercialLicenseStatus('')).toBe('missing')
    expect(
      readCommercialLicenseStatus(
        '**Status:** **RESOLVED** — claimed without evidence\n',
      ),
    ).toBe('incomplete')
    expect(
      isCommercialLicenseCleared(
        readCommercialLicenseStatus(
          '**Status:** **RESOLVED** — claimed without evidence\n',
        ),
      ),
    ).toBe(false)
    expect(isCommercialBookkeepingComplete('resolved')).toBe(true)
    expect(isCommercialBookkeepingComplete('incomplete')).toBe(false)
  })

  it('treats contradictory and duplicated Status lines as fail-closed', () => {
    expect(
      readCommercialLicenseStatus(
        '**Status:** **RESOLVED** / **UNRESOLVED** — conflict\n',
      ),
    ).toBe('unresolved')
    expect(
      readCommercialLicenseStatus(
        [
          '**Status:** **RESOLVED** — first',
          '**Status:** **UNRESOLVED** — second',
        ].join('\n'),
      ),
    ).toBe('unresolved')
    expect(
      readCommercialLicenseStatus('**Status:** **MAYBE** — weird\n'),
    ).toBe('missing')
    expect(
      readCommercialLicenseStatus('**Status:** **resolved** — lower\n'),
    ).toBe('incomplete')
  })

  it('rejects placeholders, booleans, marketing URLs, and generic license names', () => {
    for (const v of [
      '',
      'TBD',
      'todo',
      'yes',
      'true',
      'signed',
      'approved',
      'license.md',
      'README.md',
      'https://huggingface.co/briaai/RMBG-1.4',
      'https://bria.ai/pricing',
      'https://go.bria.ai/3B4Asxv',
      'https://www.huggingface.co/models',
    ]) {
      expect(isPlaceholderEvidenceArtifact(v)).toBe(true)
    }
    expect(isPlaceholderEvidenceArtifact('bria-rmbg-1.4-signed.pdf')).toBe(
      false,
    )
  })

  it('does not clear with A4 alone or artifact alone', () => {
    const onlyA4 = [
      '**Status:** **RESOLVED**',
      '| A4 | Signed PDF | [x] | path |',
    ].join('\n')
    expect(isA4EvidenceChecked(onlyA4)).toBe(true)
    expect(hasCommercialEvidenceMarkers(onlyA4)).toBe(false)
    expect(readCommercialLicenseStatus(onlyA4)).toBe('incomplete')

    const onlyArtifact = [
      '**Status:** **RESOLVED**',
      '**Evidence artifact:** bria-rmbg-1.4-signed.pdf',
      '| A4 | Signed PDF | ☐ |',
    ].join('\n')
    expect(hasCommercialEvidenceMarkers(onlyArtifact)).toBe(false)
    expect(readCommercialLicenseStatus(onlyArtifact)).toBe('incomplete')
  })

  it('bookkeeping resolved requires RESOLVED + A4 [x] + non-placeholder artifact', () => {
    expect(hasCommercialEvidenceMarkers(bookkeepingOk)).toBe(true)
    expect(readCommercialLicenseStatus(bookkeepingOk)).toBe('resolved')
    expect(isCommercialBookkeepingComplete('resolved')).toBe(true)
    expect(COMMERCIAL_GATE_LEGAL_DISCLAIMER).toMatch(/not legal permission/i)
  })

  it('owner attestation is separate from file markers and rejects placeholders', () => {
    expect(readOwnerAttestationValue(bookkeepingOk)).toMatch(/Jane Owner/)
    expect(hasOwnerAttestation(bookkeepingOk)).toBe(true)
    expect(isPlaceholderOwnerAttestation('TBD')).toBe(true)
    expect(isPlaceholderOwnerAttestation('signed')).toBe(true)
    expect(isPlaceholderOwnerAttestation('')).toBe(true)
    expect(hasOwnerAttestation('**Status:** **RESOLVED**\n')).toBe(false)
    expect(
      hasOwnerAttestation('**Owner attestation:** pending\n'),
    ).toBe(false)
  })

  it('gate outcome never equals legally approved — only pending review or blocked', () => {
    expect(
      describeCommercialGateOutcome({
        status: 'resolved',
        hasAttestation: true,
        evidencePathOk: true,
      }),
    ).toBe('evidence_present_pending_review')
    expect(
      describeCommercialGateOutcome({
        status: 'resolved',
        hasAttestation: false,
        evidencePathOk: true,
      }),
    ).toBe('blocked')
    expect(
      describeCommercialGateOutcome({
        status: 'resolved',
        hasAttestation: true,
        evidencePathOk: false,
      }),
    ).toBe('blocked')
    expect(
      describeCommercialGateOutcome({
        status: 'unresolved',
        hasAttestation: true,
        evidencePathOk: true,
      }),
    ).toBe('blocked')
  })

  it('checklist on disk is UNRESOLVED with empty evidence and no attestation', () => {
    const checklist = readFileSync(
      join(root, 'tmp-release-validation/BRIA_COMMERCIAL_LICENSE_CHECKLIST.md'),
      'utf8',
    )
    expect(readCommercialLicenseStatus(checklist)).toBe('unresolved')
    expect(hasCommercialEvidenceMarkers(checklist)).toBe(false)
    expect(hasOwnerAttestation(checklist)).toBe(false)
    const artifact = readEvidenceArtifactValue(checklist)
    expect(
      artifact === null ||
        artifact === '' ||
        isPlaceholderEvidenceArtifact(artifact),
    ).toBe(true)
  })

  it('final report cannot claim commercial ready while checklist is UNRESOLVED', () => {
    const checklist = readFileSync(
      join(root, 'tmp-release-validation/BRIA_COMMERCIAL_LICENSE_CHECKLIST.md'),
      'utf8',
    )
    const report = readFileSync(
      join(root, 'tmp-release-validation/FINAL_PRODUCTION_READINESS_REPORT.md'),
      'utf8',
    )
    if (readCommercialLicenseStatus(checklist) === 'unresolved') {
      expect(report).toMatch(/NOT READY FOR COMMERCIAL PRODUCTION/i)
      expect(report).not.toMatch(
        /\|\s*\*\*Commercial catalog[^*]*\*\*\s*\|\s*\*\*Ready\*\*/i,
      )
    }
  })

  it('physical mobile plan remains NOT RUN (no fabricated device PASSes)', () => {
    const plan = readFileSync(
      join(root, 'tmp-release-validation/PHYSICAL_MOBILE_TEST_PLAN.md'),
      'utf8',
    )
    expect(plan).toMatch(/PLAN ONLY/i)
    expect(plan).toMatch(/All scenario results below start as \*\*NOT RUN\*\*/)
    expect(plan).not.toMatch(/\|\s*T0\d\s*\|[^|\n]*\|\s*PASS\s*\|/)
  })

  it('package.json commercial verify cannot skip the require gate', () => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> }
    expect(pkg.scripts['verify:commercial-release']).toMatch(
      /gate:commercial:require/,
    )
    expect(pkg.scripts['verify:release']).toMatch(/gate:commercial/)
    expect(pkg.scripts['verify:release']).not.toMatch(
      /gate:commercial:require/,
    )
    expect(pkg.scripts['gate:commercial:require']).toMatch(
      /--require-commercial/,
    )
    expect(pkg.scripts['gate:commercial']).not.toMatch(/--require-commercial/)
  })

  it('evidence directory README exists and forbids fake agreements', () => {
    const readme = readFileSync(
      join(
        root,
        'tmp-release-validation/commercial-evidence/README.md',
      ),
      'utf8',
    )
    expect(readme).toMatch(/bookkeeping only/i)
    expect(readme).toMatch(/Do not add sample\/fake/i)
  })
})
