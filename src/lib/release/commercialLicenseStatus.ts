/**
 * Parse BRIA commercial checklist status from markdown.
 * Technical CI must not treat “tests passed” as commercial approval.
 *
 * Status `resolved` means **bookkeeping markers present**, not legal approval.
 * Use {@link describeCommercialGateOutcome} for operator-facing labels.
 */
export type CommercialLicenseStatus =
  | 'unresolved'
  | 'resolved'
  | 'missing'
  | 'incomplete'

/** Operator-facing gate outcome — never “legally approved”. */
export type CommercialGateOutcome =
  | 'blocked'
  | 'evidence_present_pending_review'

const PLACEHOLDER_ARTIFACT =
  /^(tbd|todo|n\/?a|none|pending|yes|y|true|ok|done|signed|approved|agreed|license\.md|readme\.md|\.|—|-|https?:\/\/.*)$/i

const PLACEHOLDER_ATTESTATION =
  /^(tbd|todo|n\/?a|none|pending|yes|y|true|ok|done|signed|approved|owner|admin|\.|—|-)$/i

/** Extract the Evidence artifact value, or null if the line is absent. */
export function readEvidenceArtifactValue(
  checklistMarkdown: string,
): string | null {
  const line = checklistMarkdown
    .split(/\r?\n/)
    .find((l) => /^\*\*Evidence artifact:\*\*/i.test(l))
  if (!line) return null
  return line.replace(/^\*\*Evidence artifact:\*\*/i, '').trim()
}

/** Owner attestation line (separate from file markers). */
export function readOwnerAttestationValue(
  checklistMarkdown: string,
): string | null {
  const line = checklistMarkdown
    .split(/\r?\n/)
    .find((l) => /^\*\*Owner attestation:\*\*/i.test(l))
  if (!line) return null
  return line.replace(/^\*\*Owner attestation:\*\*/i, '').trim()
}

export function isPlaceholderEvidenceArtifact(value: string): boolean {
  const v = value.trim()
  if (!v) return true
  if (PLACEHOLDER_ARTIFACT.test(v)) return true
  if (/^https?:\/\/(www\.)?(huggingface\.co|bria\.ai|go\.bria\.ai)\b/i.test(v)) {
    return true
  }
  // Generic license/readme names alone are not commercial agreements.
  if (/^(license|licence|readme)(\.(md|txt))?$/i.test(v)) return true
  return false
}

export function isPlaceholderOwnerAttestation(value: string): boolean {
  const v = value.trim()
  if (!v) return true
  if (PLACEHOLDER_ATTESTATION.test(v)) return true
  // Require a date-like token OR a name longer than 2 chars with a space/comma.
  const hasDate = /\b20\d{2}[-/.\s]\d{1,2}[-/.\s]\d{1,2}\b/.test(v)
  const hasName = /[A-Za-z]{2,}[, ]+[A-Za-z]{2,}/.test(v) || v.length >= 5
  return !(hasDate || hasName)
}

export function hasOwnerAttestation(checklistMarkdown: string): boolean {
  const value = readOwnerAttestationValue(checklistMarkdown)
  if (value == null) return false
  return !isPlaceholderOwnerAttestation(value)
}

export function isA4EvidenceChecked(checklistMarkdown: string): boolean {
  const a4 = checklistMarkdown
    .split(/\r?\n/)
    .find((line) => /^\|\s*A4\s*\|/i.test(line))
  if (!a4) return false
  return /\[[xX]\]/.test(a4) || /[☑✅]/.test(a4)
}

/**
 * Bookkeeping markers only (A4 + artifact text). Not legal proof.
 */
export function hasCommercialEvidenceMarkers(
  checklistMarkdown: string,
): boolean {
  if (!isA4EvidenceChecked(checklistMarkdown)) return false
  const artifact = readEvidenceArtifactValue(checklistMarkdown)
  if (artifact == null || isPlaceholderEvidenceArtifact(artifact)) return false
  return true
}

export function readCommercialLicenseStatus(
  checklistMarkdown: string,
): CommercialLicenseStatus {
  const statusLines = checklistMarkdown
    .split(/\r?\n/)
    .filter((line) => /^\*\*Status:\*\*/i.test(line))
  if (statusLines.length === 0) return 'missing'
  // Duplicated contradictory Status lines → fail closed.
  if (statusLines.length > 1) {
    const texts = statusLines.join(' ')
    const hasU = /\bUNRESOLVED\b/i.test(texts)
    const hasR = /\bRESOLVED\b/i.test(texts)
    if (hasU && hasR) return 'unresolved'
    if (hasU) return 'unresolved'
    if (hasR) {
      return hasCommercialEvidenceMarkers(checklistMarkdown)
        ? 'resolved'
        : 'incomplete'
    }
    return 'missing'
  }

  const statusLine = statusLines[0]!

  if (/\bUNRESOLVED\b/i.test(statusLine)) {
    return 'unresolved'
  }

  if (/\bRESOLVED\b/i.test(statusLine)) {
    return hasCommercialEvidenceMarkers(checklistMarkdown)
      ? 'resolved'
      : 'incomplete'
  }

  // Unexpected capitalization variants already covered by /i; other words → missing.
  if (/status:\s*\*\*[^*]+\*\*/i.test(statusLine)) return 'missing'
  return 'missing'
}

/** Bookkeeping complete — NOT legal clearance. */
export function isCommercialBookkeepingComplete(
  status: CommercialLicenseStatus,
): boolean {
  return status === 'resolved'
}

/** @deprecated Use isCommercialBookkeepingComplete — name implied legal clearance. */
export function isCommercialLicenseCleared(
  status: CommercialLicenseStatus,
): boolean {
  return isCommercialBookkeepingComplete(status)
}

/**
 * `--require-commercial` may exit 0 only when bookkeeping + owner attestation
 * are present. Outcome is still pending legal/counsel review — never “approved”.
 */
export function describeCommercialGateOutcome(args: {
  status: CommercialLicenseStatus
  hasAttestation: boolean
  evidencePathOk: boolean
}): CommercialGateOutcome {
  if (
    args.status === 'resolved' &&
    args.hasAttestation &&
    args.evidencePathOk
  ) {
    return 'evidence_present_pending_review'
  }
  return 'blocked'
}

export const COMMERCIAL_GATE_LEGAL_DISCLAIMER =
  'Automated gate checks checklist bookkeeping only. It does not verify that BRIA granted commercial rights. A path, checkbox, nonempty file, or owner attestation line is not legal permission — counsel/owner must review the actual agreement. Outcome evidence_present_pending_review ≠ commercially approved.'
