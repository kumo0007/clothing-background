const fs = require('fs')
const path = require('path')
const os = require('os')
const jpeg = require('jpeg-js')
const { spawn } = require('child_process')

const file = process.argv[2] || '03_tshirt.jpg'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'))
const rgbaPath = path.join(dir, 'rgba.bin')
const maskPath = path.join(dir, 'mask.bin')
const optionsPath = path.join(dir, 'options.json')

const d = jpeg.decode(
  fs.readFileSync(path.join(__dirname, '../public/testdata/clothing', file)),
  { useTArray: true, formatAsRGBA: true },
)
fs.writeFileSync(rgbaPath, Buffer.from(d.data))
fs.writeFileSync(
  optionsPath,
  JSON.stringify({ maxWorkingSide: 160, grabCutIters: 2 }),
)
console.log('prepared', file, d.width, 'x', d.height)

const once = path.join(__dirname, '../src/lib/mask/opencv/segmentOnce.cjs')
const child = spawn(
  process.execPath,
  [once, rgbaPath, String(d.width), String(d.height), maskPath, optionsPath],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
)

child.stdout.on('data', (c) => process.stdout.write(c))
child.stderr.on('data', (c) => process.stderr.write(c))
child.on('close', (code) => {
  console.log('exit', code)
  if (fs.existsSync(maskPath)) {
    const mask = fs.readFileSync(maskPath)
    let keep = 0
    for (let i = 0; i < mask.length; i++) if (mask[i] >= 200) keep++
    console.log('keep', keep, '/', mask.length)
  }
  fs.rmSync(dir, { recursive: true, force: true })
  process.exit(code || 0)
})
setTimeout(() => {
  console.error('KILL timeout')
  child.kill()
  process.exit(1)
}, 90000)
