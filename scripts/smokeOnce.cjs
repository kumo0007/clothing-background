const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const jpeg = require('jpeg-js')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'))
const rgbaPath = path.join(dir, 'rgba.bin')
const maskPath = path.join(dir, 'mask.bin')
const optionsPath = path.join(dir, 'options.json')

const d = jpeg.decode(
  fs.readFileSync(path.join(__dirname, '../public/testdata/clothing/03_tshirt.jpg')),
  { useTArray: true, formatAsRGBA: true },
)
fs.writeFileSync(rgbaPath, Buffer.from(d.data))
fs.writeFileSync(
  optionsPath,
  JSON.stringify({ maxWorkingSide: 256, grabCutIters: 2 }),
)

const once = path.join(__dirname, '../src/lib/mask/opencv/segmentOnce.cjs')
const r = spawnSync(
  process.execPath,
  [once, rgbaPath, String(d.width), String(d.height), maskPath, optionsPath],
  { encoding: 'utf8', timeout: 120000 },
)
console.log('status', r.status)
console.log('stdout', r.stdout)
console.log('stderr', r.stderr)
if (fs.existsSync(maskPath)) {
  const mask = fs.readFileSync(maskPath)
  let keep = 0
  for (let i = 0; i < mask.length; i++) if (mask[i] >= 200) keep++
  console.log('keep', keep, '/', mask.length)
}
fs.rmSync(dir, { recursive: true, force: true })
