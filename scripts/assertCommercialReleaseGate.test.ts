/** @vitest-environment node */
/**
 * Wiring / invocation tests for the commercial release gate script.
 * Spawns the real script; does not fabricate legal approval.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const script = join(root, 'scripts/assertCommercialReleaseGate.mts')

function runGate(args: string[]): {
  exitCode: number
  stdout: string
  stderr: string
} {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', script, ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        // Adversarial: env vars must not bypass the gate.
        COMMERCIAL_LICENSE_APPROVED: '1',
        BRIA_COMMERCIAL_OK: 'true',
        FORCE_COMMERCIAL_CLEAR: 'yes',
      },
    },
  )
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('assertCommercialReleaseGate script wiring', () => {
  it('informational mode exits 0 while UNRESOLVED and does not claim legal approval', () => {
    const r = runGate([])
    expect(r.exitCode).toBe(0)
    const out = r.stdout + r.stderr
    expect(out).toMatch(/bookkeeping status:\s*unresolved/i)
    expect(out).toMatch(/does not verify that BRIA granted/i)
    expect(out).not.toMatch(/\blegally approved\b/i)
    expect(out).toMatch(/≠ commercially approved|NOT commercially approved|pending.review/i)
  })

  it('--require-commercial exits 1 while licensing is outstanding', () => {
    const r = runGate(['--require-commercial'])
    expect(r.exitCode).toBe(1)
    const out = r.stdout + r.stderr
    expect(out).toMatch(/BLOCKED|UNRESOLVED|bookkeeping status:\s*unresolved/i)
  })

  it('unknown flags and approval-looking env vars do not bypass require gate', () => {
    const r = runGate([
      '--require-commercial',
      '--force-approve',
      '--skip-license',
    ])
    expect(r.exitCode).toBe(1)
    const out = r.stdout + r.stderr
    expect(out).toMatch(/ignoring unknown flags/i)
  })
})
