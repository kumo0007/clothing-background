import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('emitBgRemoveWorker patch contract', () => {
  it('upstream SDK worker still has the allowLocalModels=!1 marker', () => {
    const worker = readFileSync(
      join(process.cwd(), 'node_modules/bg-remove-sdk/dist/worker.js'),
      'utf8',
    )
    expect(worker).toContain('mv.allowLocalModels = !1')
  })
})
