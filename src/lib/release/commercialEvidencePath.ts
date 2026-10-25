/**
 * Resolve commercial-evidence paths under a single permitted directory.
 * Bookkeeping only — never legal proof of BRIA authorization.
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { isPlaceholderEvidenceArtifact } from './commercialLicenseStatus'

/** Repo-relative directory for offline commercial evidence (do not commit PDFs by default). */
export const COMMERCIAL_EVIDENCE_DIR =
  'tmp-release-validation/commercial-evidence'

export type EvidencePathResult =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: string }

function underRoot(filePath: string, rootDir: string): boolean {
  const root = resolve(rootDir)
  const file = resolve(filePath)
  const prefix = root.endsWith(sep) ? root : root + sep
  return file === root || file.startsWith(prefix)
}

/**
 * Map an Evidence artifact string to a file under `commercial-evidence/`.
 * Rejects URLs, traversal, absolute paths outside the evidence root, empty /
 * whitespace-only / URL-only files, and symlinks that escape the root.
 */
export function resolvePermittedEvidencePath(
  artifact: string,
  repoRoot: string,
): EvidencePathResult {
  const trimmed = artifact.trim()
  if (!trimmed || isPlaceholderEvidenceArtifact(trimmed)) {
    return { ok: false, reason: 'placeholder or empty evidence artifact' }
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return {
      ok: false,
      reason: 'remote URLs are not permitted evidence paths',
    }
  }
  if (trimmed.includes('\0')) {
    return { ok: false, reason: 'invalid NUL in evidence path' }
  }
  if (/^file:/i.test(trimmed)) {
    return { ok: false, reason: 'file: URLs are not permitted' }
  }

  const evidenceRoot = resolve(repoRoot, COMMERCIAL_EVIDENCE_DIR)

  // Relative paths are always resolved under the evidence directory (not repo root).
  // Absolute paths must still resolve inside that directory after normalization.
  let candidate: string
  if (isAbsolute(trimmed)) {
    candidate = resolve(trimmed)
  } else {
    const rel = trimmed.replace(/^[.][/\\]+/, '').replace(/^[/\\]+/, '')
    if (rel.split(/[/\\]/).includes('..')) {
      return { ok: false, reason: 'path traversal segments are not permitted' }
    }
    // Allow optional commercial-evidence/ prefix in checklist values.
    const stripped = rel.replace(
      /^tmp-release-validation[/\\]commercial-evidence[/\\]/i,
      '',
    )
    candidate = resolve(evidenceRoot, stripped)
  }

  if (!underRoot(candidate, evidenceRoot)) {
    return {
      ok: false,
      reason: 'evidence path resolves outside commercial-evidence directory',
    }
  }

  if (!existsSync(candidate)) {
    return { ok: false, reason: 'evidence file not found under commercial-evidence/' }
  }

  let lst
  try {
    lst = lstatSync(candidate)
  } catch {
    return { ok: false, reason: 'evidence path is unreadable' }
  }

  if (lst.isSymbolicLink()) {
    let real: string
    try {
      real = realpathSync(candidate)
    } catch {
      return { ok: false, reason: 'symlink target is unreadable' }
    }
    if (!underRoot(real, evidenceRoot)) {
      return {
        ok: false,
        reason: 'symlink escapes commercial-evidence directory',
      }
    }
  }

  if (!lst.isFile() && !lst.isSymbolicLink()) {
    return { ok: false, reason: 'evidence path is not a regular file' }
  }

  let size = lst.size
  try {
    size = statSync(candidate).size
  } catch {
    return { ok: false, reason: 'evidence path is unreadable' }
  }
  if (size <= 0) {
    return { ok: false, reason: 'evidence file is empty (0 bytes)' }
  }

  // Small / text-like files: reject whitespace-only or single marketing URL body.
  if (size <= 4096) {
    try {
      const body = readFileSync(candidate, 'utf8')
      const text = body.trim()
      if (!text) {
        return { ok: false, reason: 'evidence file is whitespace-only' }
      }
      if (
        /^https?:\/\/\S+$/i.test(text) ||
        isPlaceholderEvidenceArtifact(text)
      ) {
        return {
          ok: false,
          reason: 'evidence file contains only a URL or placeholder text',
        }
      }
    } catch {
      // Binary PDF/etc. — OK if nonempty.
    }
  }

  return { ok: true, absolutePath: resolve(candidate) }
}
