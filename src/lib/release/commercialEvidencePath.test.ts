/** @vitest-environment node */
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  COMMERCIAL_EVIDENCE_DIR,
  resolvePermittedEvidencePath,
} from './commercialEvidencePath'

const temps: string[] = []

afterEach(() => {
  for (const t of temps.splice(0)) {
    try {
      rmSync(t, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

function makeRepo(): { root: string; evidenceDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'comm-ev-'))
  temps.push(root)
  const evidenceDir = join(root, COMMERCIAL_EVIDENCE_DIR)
  mkdirSync(evidenceDir, { recursive: true })
  return { root, evidenceDir }
}

describe('resolvePermittedEvidencePath', () => {
  it('rejects empty, placeholder, URL, and file: schemes', () => {
    const { root } = makeRepo()
    for (const a of ['', '  ', 'TBD', 'yes', 'https://bria.ai/x', 'file:///etc/passwd']) {
      expect(resolvePermittedEvidencePath(a, root).ok).toBe(false)
    }
  })

  it('rejects path traversal and absolute escape outside evidence dir', () => {
    const { root, evidenceDir } = makeRepo()
    writeFileSync(join(evidenceDir, 'ok.bin'), 'not-empty-agreement-bytes')
    expect(resolvePermittedEvidencePath('../ok.bin', root).ok).toBe(false)
    expect(
      resolvePermittedEvidencePath('foo/../../etc/passwd', root).ok,
    ).toBe(false)
    expect(
      resolvePermittedEvidencePath(join(root, 'outside.txt'), root).ok,
    ).toBe(false)
    writeFileSync(join(root, 'outside.txt'), 'secret')
    expect(
      resolvePermittedEvidencePath(join(root, 'outside.txt'), root).ok,
    ).toBe(false)
  })

  it('accepts nonempty file under commercial-evidence/', () => {
    const { root, evidenceDir } = makeRepo()
    writeFileSync(join(evidenceDir, 'bria-grant.bin'), 'offline-artifact-bytes')
    const r = resolvePermittedEvidencePath('bria-grant.bin', root)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.absolutePath).toContain('commercial-evidence')
  })

  it('rejects missing, empty, whitespace-only, and URL-only files', () => {
    const { root, evidenceDir } = makeRepo()
    expect(resolvePermittedEvidencePath('missing.pdf', root).ok).toBe(false)
    writeFileSync(join(evidenceDir, 'empty.pdf'), '')
    expect(resolvePermittedEvidencePath('empty.pdf', root).ok).toBe(false)
    writeFileSync(join(evidenceDir, 'ws.txt'), '   \n\t  ')
    expect(resolvePermittedEvidencePath('ws.txt', root).ok).toBe(false)
    writeFileSync(
      join(evidenceDir, 'url-only.txt'),
      'https://huggingface.co/briaai/RMBG-1.4\n',
    )
    expect(resolvePermittedEvidencePath('url-only.txt', root).ok).toBe(false)
  })

  it('rejects directories as evidence paths', () => {
    const { root, evidenceDir } = makeRepo()
    mkdirSync(join(evidenceDir, 'subdir'))
    expect(resolvePermittedEvidencePath('subdir', root).ok).toBe(false)
  })

  it('rejects symlinks that escape commercial-evidence/', () => {
    const { root, evidenceDir } = makeRepo()
    const outside = join(root, 'outside-secret.bin')
    writeFileSync(outside, 'should-not-be-readable-as-evidence')
    const link = join(evidenceDir, 'escape.link')
    try {
      symlinkSync(outside, link)
    } catch {
      // Windows may require elevated privileges for symlinks — skip if unavailable.
      return
    }
    const r = resolvePermittedEvidencePath('escape.link', root)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/symlink escapes|unreadable/i)
  })

  it('allows optional commercial-evidence/ prefix in artifact string', () => {
    const { root, evidenceDir } = makeRepo()
    writeFileSync(join(evidenceDir, 'a.bin'), 'bytes-here')
    expect(
      resolvePermittedEvidencePath(
        'tmp-release-validation/commercial-evidence/a.bin',
        root,
      ).ok,
    ).toBe(true)
  })
})
