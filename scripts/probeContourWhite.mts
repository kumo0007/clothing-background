import { segmentGarmentContourFirst } from '../src/lib/mask/contourFirst/contourFirstSegment'

function makeImage(
  w: number,
  h: number,
  fill: [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = fill[0]
    data[i * 4 + 1] = fill[1]
    data[i * 4 + 2] = fill[2]
    data[i * 4 + 3] = 255
  }
  return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData
}
function setRgb(
  image: ImageData,
  x: number,
  y: number,
  rgb: [number, number, number],
) {
  const o = (y * image.width + x) * 4
  image.data[o] = rgb[0]
  image.data[o + 1] = rgb[1]
  image.data[o + 2] = rgb[2]
}

const w = 48
const h = 48
const img = makeImage(w, h, [226, 226, 226])
for (let y = 10; y < 38; y += 1) {
  for (let x = 10; x < 38; x += 1) {
    const onRim = x === 10 || y === 10 || x === 37 || y === 37
    setRgb(img, x, y, onRim ? [210, 210, 210] : [232, 232, 232])
  }
}
for (let x = 20; x < 28; x += 1) {
  setRgb(img, x, 14, [40, 40, 40])
  setRgb(img, x, 15, [40, 40, 40])
}
const r = segmentGarmentContourFirst(img, { includeDebug: true })
let keep = 0
for (let i = 0; i < r.mask.data.length; i += 1) {
  if (r.mask.data[i]! >= 128) keep += 1
}
console.log(
  JSON.stringify(
    {
      accepted: r.diagnostics.contourAccepted,
      reason: r.diagnostics.rejectReason,
      stages: r.diagnostics.stages,
      area: r.diagnostics.outerAreaRatio,
      seedAgr: r.diagnostics.seedAgreement,
      center: r.mask.data[24 * w + 24],
      keep,
      needsReview: r.needsReview,
    },
    null,
    2,
  ),
)
