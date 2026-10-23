const { fork } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const jpeg = require('jpeg-js')

const worker = path.join(__dirname, '../src/lib/mask/opencv/segmentWorker.cjs')
const p = fork(worker, [], {
  stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  windowsHide: true,
})

p.stderr.on('data', (c) => process.stderr.write('ERR:' + c.toString()))
p.on('exit', (code, signal) => console.error('worker exit', code, signal))

function once(pred, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    const onMsg = (msg) => {
      if (pred(msg)) {
        clearTimeout(t)
        p.off('message', onMsg)
        resolve(msg)
      }
    }
    p.on('message', onMsg)
  })
}

async function main() {
  await once((m) => m.ready, 30000)
  console.log('ready')

  p.send({ id: 1, cmd: 'ping' })
  const ping = await once((m) => m.id === 1, 60000)
  console.log('ping', ping)

  const raw = fs.readFileSync(
    path.join(__dirname, '../public/testdata/clothing/03_tshirt.jpg'),
  )
  const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'))
  const rgbaPath = path.join(dir, 'rgba.bin')
  fs.writeFileSync(rgbaPath, Buffer.from(d.data))

  p.send({
    id: 2,
    width: d.width,
    height: d.height,
    rgbaPath,
    options: { maxWorkingSide: 256, grabCutIters: 2 },
  })
  const seg = await once((m) => m.id === 2, 120000)
  console.log('seg', {
    ok: seg.ok,
    methodUsed: seg.methodUsed,
    elapsedMs: seg.elapsedMs,
    maskPath: seg.maskPath,
    error: seg.error,
  })
  if (seg.maskPath) {
    const mask = fs.readFileSync(seg.maskPath)
    let keep = 0
    for (let i = 0; i < mask.length; i++) if (mask[i] >= 200) keep++
    console.log('keep', keep, '/', mask.length)
  }
  p.kill()
  fs.rmSync(dir, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  p.kill()
  process.exit(1)
})
