/**
 * Clean Node OpenCV worker (no Vite transform).
 *
 * Protocol (JSON line in, JSON line out):
 *   { id, cmd:'ping' }
 *   { id, width, height, rgbaPath, options? }  // rgbaPath = raw Uint8 file
 *
 * Response:
 *   { id, ok, maskPath?, methodUsed?, elapsedMs?, workingWidth?, workingHeight?, error? }
 */
process.stderr.write('[opencv-worker] boot\n')
const fs = require('fs')
const path = require('path')
const os = require('os')
process.stderr.write('[opencv-worker] listening\n')

let cvReady = null

function loadCv() {
  if (cvReady) return cvReady
  cvReady = new Promise((resolve, reject) => {
    const cv = require('@techstark/opencv-js')
    const t = setTimeout(() => reject(new Error('OpenCV init timeout')), 120000)
    const done = () => {
      clearTimeout(t)
      if (typeof cv.Mat !== 'function') {
        reject(new Error('cv.Mat missing'))
        return
      }
      resolve(cv)
    }
    if (typeof cv.Mat === 'function') done()
    else if (typeof cv.then === 'function') {
      cv.then(() => done(), reject)
      const start = Date.now()
      const poll = setInterval(() => {
        if (typeof cv.Mat === 'function') {
          clearInterval(poll)
          done()
        } else if (Date.now() - start > 110000) clearInterval(poll)
      }, 25)
    } else reject(new Error('OpenCV module not thenable'))
  })
  return cvReady
}

function labDist(p, q) {
  const dL = p.L - q.L
  const da = p.a - q.a
  const db = p.b - q.b
  return Math.sqrt(dL * dL + da * da + db * db)
}

function estimateBackgroundLab(labData, width, height, step = 2) {
  const samples = []
  const band = Math.max(1, Math.min(6, Math.floor(Math.min(width, height) * 0.02)))
  const push = (x, y) => {
    const o = (y * width + x) * 3
    samples.push({ L: labData[o], a: labData[o + 1], b: labData[o + 2] })
  }
  for (let y = 0; y < band; y++) for (let x = 0; x < width; x += step) push(x, y)
  for (let y = height - band; y < height; y++)
    for (let x = 0; x < width; x += step) push(x, y)
  for (let y = band; y < height - band; y += step) {
    for (let x = 0; x < band; x++) push(x, y)
    for (let x = width - band; x < width; x++) push(x, y)
  }
  samples.sort((u, v) => u.L - v.L)
  const lo = Math.floor(samples.length * 0.1)
  const hi = Math.max(lo + 1, Math.ceil(samples.length * 0.9))
  const trimmed = samples.slice(lo, hi)
  let sL = 0
  let sa = 0
  let sb = 0
  for (const s of trimmed) {
    sL += s.L
    sa += s.a
    sb += s.b
  }
  const n = trimmed.length || 1
  const mean = { L: sL / n, a: sa / n, b: sb / n }
  const dists = trimmed.map((s) => labDist(s, mean)).sort((a, b) => a - b)
  const mad = dists[Math.floor(dists.length / 2)] || 8
  return { mean, mad: Math.max(4, mad) }
}

function buildSeedMask(cv, labData, width, height, bg) {
  const pixels = width * height
  const dist = new Float32Array(pixels)
  const lumaVar = new Float32Array(pixels)
  const bgThresh = Math.min(22, Math.max(10, bg.mad * 2.2))
  const fgThresh = Math.max(bgThresh + 8, bg.mad * 4.5)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const o = i * 3
      dist[i] = labDist(
        { L: labData[o], a: labData[o + 1], b: labData[o + 2] },
        bg.mean,
      )
      let sum = 0
      let sumSq = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy))
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx))
          const L = labData[(yy * width + xx) * 3]
          sum += L
          sumSq += L * L
          count++
        }
      }
      const mean = sum / count
      lumaVar[i] = sumSq / count - mean * mean
    }
  }

  const definiteBg = new Uint8Array(pixels)
  const queue = []
  const trySeed = (x, y) => {
    const i = y * width + x
    if (dist[i] <= bgThresh * 1.15) {
      definiteBg[i] = 1
      queue.push(i)
    }
  }
  for (let x = 0; x < width; x++) {
    trySeed(x, 0)
    trySeed(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    trySeed(0, y)
    trySeed(width - 1, y)
  }
  let head = 0
  while (head < queue.length) {
    const i = queue[head++]
    const x = i % width
    const y = (i / width) | 0
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x + 1 < width ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y + 1 < height ? i + width : -1,
    ]
    for (const n of neighbors) {
      if (n < 0 || definiteBg[n]) continue
      if (dist[n] <= bgThresh * 1.35) {
        definiteBg[n] = 1
        queue.push(n)
      }
    }
  }

  const seeds = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) {
    if (definiteBg[i]) {
      seeds[i] = cv.GC_BGD
      continue
    }
    const d = dist[i]
    const o = i * 3
    const da = labData[o + 1] - 128
    const db = labData[o + 2] - 128
    const chroma = Math.sqrt(da * da + db * db)
    const L = labData[o]
    const textured = lumaVar[i] > 18
    const chromatic = chroma > 14
    const dark = L < 90
    const warm = labData[o + 2] > 140 && labData[o + 1] > 120 && chroma > 10
    if (d >= fgThresh || dark || (chromatic && d > bgThresh) || warm) {
      seeds[i] = cv.GC_FGD
    } else if (d <= bgThresh * 1.5 && (textured || L > bg.mean.L + 4)) {
      seeds[i] = cv.GC_PR_FGD
    } else if (d <= bgThresh * 1.1) {
      seeds[i] = cv.GC_PR_BGD
    } else {
      seeds[i] = cv.GC_PR_FGD
    }
  }

  let hasFgd = false
  let hasBgd = false
  for (let i = 0; i < pixels; i++) {
    const s = seeds[i]
    if (s === cv.GC_FGD || s === cv.GC_PR_FGD) hasFgd = true
    if (s === cv.GC_BGD || s === cv.GC_PR_BGD) hasBgd = true
    if (hasFgd && hasBgd) break
  }
  if (!hasBgd) {
    for (let x = 0; x < width; x++) {
      seeds[x] = cv.GC_BGD
      seeds[(height - 1) * width + x] = cv.GC_BGD
    }
  }
  if (!hasFgd) {
    const cx = (width / 2) | 0
    const cy = (height / 2) | 0
    const r = Math.max(2, Math.floor(Math.min(width, height) * 0.08))
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const i = y * width + x
        if (!definiteBg[i]) seeds[i] = cv.GC_FGD
      }
    }
  }
  return seeds
}

function labelsToMask(labels, cv, width, height, labData, bgMean) {
  const data = new Uint8Array(width * height)
  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i]
    if (lab === cv.GC_FGD || lab === cv.GC_PR_FGD) {
      data[i] = 255
    } else {
      const o = i * 3
      const d = labDist(
        { L: labData[o], a: labData[o + 1], b: labData[o + 2] },
        bgMean,
      )
      if (lab === cv.GC_PR_BGD && d > 14) {
        data[i] = Math.min(160, Math.floor(40 + d * 4))
      } else {
        data[i] = 0
      }
    }
  }
  return data
}

function seedsToMask(seeds, cv, width, height, labData, bgMean) {
  const data = new Uint8Array(width * height)
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i]
    if (s === cv.GC_FGD || s === cv.GC_PR_FGD) data[i] = 255
    else if (s === cv.GC_PR_BGD) {
      const o = i * 3
      const d = labDist(
        { L: labData[o], a: labData[o + 1], b: labData[o + 2] },
        bgMean,
      )
      data[i] = d > 10 ? Math.min(200, Math.floor(d * 8)) : 0
    } else data[i] = 0
  }
  return data
}

function softenBoundary(mask, labData, width, height, bgMean) {
  const src = Buffer.from(mask)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const v = src[i]
      let minN = 255
      let maxN = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = src[(y + dy) * width + (x + dx)]
          if (n < minN) minN = n
          if (n > maxN) maxN = n
        }
      }
      if (maxN - minN < 40) continue
      const o = i * 3
      const d = labDist(
        { L: labData[o], a: labData[o + 1], b: labData[o + 2] },
        bgMean,
      )
      const soft = Math.max(0, Math.min(255, Math.floor(d * 10)))
      if (v >= 200) mask[i] = Math.max(soft, Math.min(255, Math.floor((v + soft) / 2)))
      else if (v <= 20 && soft > 40 && maxN >= 200) mask[i] = Math.min(180, soft)
    }
  }
}

function deleteMats(...mats) {
  for (const m of mats) {
    if (m)
      try {
        m.delete()
      } catch (_) {}
  }
}

async function segment(msg) {
  const cv = await loadCv()
  const t0 = Date.now()
  const { width: srcW, height: srcH, rgbaPath, options = {} } = msg
  const maxWorkingSide = options.maxWorkingSide || 512
  const grabCutIters = options.grabCutIters || 3
  const forceSeedFallback = !!options.forceSeedFallback

  const rgbaBuf = fs.readFileSync(rgbaPath)
  const rgba = new Uint8ClampedArray(rgbaBuf.buffer, rgbaBuf.byteOffset, rgbaBuf.byteLength)

  const scale = Math.min(1, maxWorkingSide / Math.max(srcW, srcH))
  const workW = Math.max(1, Math.round(srcW * scale))
  const workH = Math.max(1, Math.round(srcH * scale))

  const rgbaMat = cv.matFromImageData({ width: srcW, height: srcH, data: rgba })
  const rgbFull = new cv.Mat()
  cv.cvtColor(rgbaMat, rgbFull, cv.COLOR_RGBA2RGB)
  const labFull = new cv.Mat()
  cv.cvtColor(rgbFull, labFull, cv.COLOR_RGB2Lab)

  let workRgb = rgbFull
  let workLab = labFull
  let resizedRgb = null
  let resizedLab = null
  if (scale < 1) {
    resizedRgb = new cv.Mat()
    resizedLab = new cv.Mat()
    cv.resize(rgbFull, resizedRgb, new cv.Size(workW, workH), 0, 0, cv.INTER_LINEAR)
    cv.resize(labFull, resizedLab, new cv.Size(workW, workH), 0, 0, cv.INTER_LINEAR)
    workRgb = resizedRgb
    workLab = resizedLab
  }

  const labData = new Uint8Array(workLab.data)
  const bg = estimateBackgroundLab(labData, workW, workH)
  const seeds = buildSeedMask(cv, labData, workW, workH, bg)

  let methodUsed = 'opencv-seed-fallback'
  let workMask

  if (typeof cv.grabCut === 'function' && !forceSeedFallback) {
    const gcMask = cv.matFromArray(workH, workW, cv.CV_8UC1, seeds)
    const bgdModel = new cv.Mat(1, 65, cv.CV_64FC1)
    const fgdModel = new cv.Mat(1, 65, cv.CV_64FC1)
    bgdModel.data64F.fill(0)
    fgdModel.data64F.fill(0)
    try {
      cv.grabCut(
        workRgb,
        gcMask,
        new cv.Rect(0, 0, workW, workH),
        bgdModel,
        fgdModel,
        grabCutIters,
        cv.GC_INIT_WITH_MASK,
      )
      workMask = labelsToMask(gcMask.data, cv, workW, workH, labData, bg.mean)
      methodUsed = 'opencv-grabcut'
    } catch (err) {
      workMask = seedsToMask(seeds, cv, workW, workH, labData, bg.mean)
      methodUsed = 'opencv-seed-fallback'
    }
    deleteMats(gcMask, bgdModel, fgdModel)
  } else {
    workMask = seedsToMask(seeds, cv, workW, workH, labData, bg.mean)
  }

  softenBoundary(workMask, labData, workW, workH, bg.mean)

  let finalMask = workMask
  if (workW !== srcW || workH !== srcH) {
    const small = cv.matFromArray(workH, workW, cv.CV_8UC1, workMask)
    const up = new cv.Mat()
    cv.resize(small, up, new cv.Size(srcW, srcH), 0, 0, cv.INTER_LINEAR)
    finalMask = new Uint8Array(up.data)
    deleteMats(small, up)
  }

  deleteMats(rgbaMat, rgbFull, labFull, resizedRgb, resizedLab)

  const maskPath = path.join(
    os.tmpdir(),
    `garment-mask-${process.pid}-${Date.now()}.bin`,
  )
  fs.writeFileSync(maskPath, Buffer.from(finalMask))

  return {
    maskPath,
    methodUsed,
    elapsedMs: Date.now() - t0,
    workingWidth: workW,
    workingHeight: workH,
  }
}

async function handle(msg) {
  try {
    const result = await segment(msg)
    const out = { id: msg.id, ok: true, ...result }
    if (process.send) process.send(out)
    else process.stdout.write(JSON.stringify(out) + '\n')
    return out
  } catch (err) {
    const out = {
      id: msg.id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    }
    if (process.send) process.send(out)
    else process.stdout.write(JSON.stringify(out) + '\n')
    return out
  }
}

process.stderr.write('[opencv-worker] stdin mode=' + process.stdin.readable + '\n')

function onMessage(msg) {
  process.stderr.write('[opencv-worker] msg cmd=' + (msg.cmd || 'segment') + '\n')
  if (msg.cmd === 'ping') {
    loadCv()
      .then(() => {
        const out = JSON.stringify({
          id: msg.id,
          ok: true,
          pong: true,
          grabCut: true,
        })
        process.stderr.write('[opencv-worker] pong\n')
        if (process.send) process.send(JSON.parse(out))
        else process.stdout.write(out + '\n')
      })
      .catch((err) => {
        const out = JSON.stringify({
          id: msg.id,
          ok: false,
          error: err.message || String(err),
        })
        if (process.send) process.send(JSON.parse(out))
        else process.stdout.write(out + '\n')
      })
    return
  }
  void handle(msg)
}

if (process.send) {
  // fork() IPC
  process.on('message', onMessage)
  process.stderr.write('[opencv-worker] ipc ready\n')
  process.send({ ok: true, ready: true })
} else {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    process.stderr.write('[opencv-worker] stdin chunk ' + chunk.length + '\n')
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line.trim()) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch (_) {
        process.stdout.write(
          JSON.stringify({ ok: false, error: 'invalid json' }) + '\n',
        )
        continue
      }
      onMessage(msg)
    }
  })
  process.stdin.resume()
  process.stderr.write('[opencv-worker] stdin ready\n')
}
