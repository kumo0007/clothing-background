import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { createMaskBuffer, cloneMaskBuffer } from '../src/lib/mask/createMask'
import { refineIsnetWithEvidence } from '../src/lib/mask/isnetEvidenceRefine'

function loadJpeg(name: string) {
  const d = jpeg.decode(readFileSync(join('public/testdata/clothing', name)), {
    useTArray: true,
    formatAsRGBA: true,
  })
  return {
    width: d.width,
    height: d.height,
    data: new Uint8ClampedArray(
      d.data.buffer,
      d.data.byteOffset,
      d.data.byteLength,
    ),
    colorSpace: 'srgb',
  } as ImageData
}

function loadMask(p: string) {
  const png = PNG.sync.read(readFileSync(p))
  const m = createMaskBuffer(png.width, png.height, 0)
  for (let i = 0; i < m.data.length; i += 1) m.data[i] = png.data[i * 4]!
  return m
}

function comps(mask: { width: number; height: number; data: Uint8ClampedArray }) {
  const w = mask.width
  const h = mask.height
  const data = mask.data
  const seen = new Uint8Array(data.length)
  const out: Array<{
    size: number
    minX: number
    maxX: number
    minY: number
    maxY: number
  }> = []
  for (let s = 0; s < data.length; s += 1) {
    if (seen[s] || data[s]! < 128) continue
    const q = [s]
    let head = 0
    seen[s] = 1
    let minX = w
    let maxX = 0
    let minY = h
    let maxY = 0
    let size = 0
    while (head < q.length) {
      const i = q[head++]!
      size += 1
      const x = i % w
      const y = (i / w) | 0
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      for (const n of [
        x > 0 ? i - 1 : -1,
        x + 1 < w ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y + 1 < h ? i + w : -1,
      ]) {
        if (n < 0 || seen[n] || data[n]! < 128) continue
        seen[n] = 1
        q.push(n)
      }
    }
    out.push({ size, minX, maxX, minY, maxY })
  }
  return out.sort((a, b) => b.size - a.size)
}

const image = loadJpeg('08_sneakers.jpg')
const raw = loadMask('tmp-model-compare/isnet/masks/08_sneakers-mask.png')
console.log('raw comps', comps(raw).slice(0, 4))
const { mask, diagnostics } = refineIsnetWithEvidence(cloneMaskBuffer(raw), image)
console.log('after comps', comps(mask).slice(0, 4))
console.log(
  JSON.stringify(
    {
      accept: diagnostics.refinementAccepted,
      reason: diagnostics.acceptReason || diagnostics.rejectReason,
      gates: diagnostics.gateValues,
      ops: diagnostics.refinementOps,
      modes: diagnostics.failureModes,
    },
    null,
    2,
  ),
)
