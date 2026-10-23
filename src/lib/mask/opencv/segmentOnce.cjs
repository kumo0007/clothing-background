/**
 * One-shot OpenCV segment process. Args:
 *   node segmentOnce.cjs <rgbaPath> <width> <height> <outMaskPath> [optionsJson]
 * Exit 0 + writes mask file; prints JSON summary to stdout.
 */
const fs = require('fs')
const path = require('path')

// Minimal browser stubs — same as probeOpenCvApis.cjs (OpenCV.js expects them).
if (typeof global.document === 'undefined') {
  global.document = {
    getElementById: () => null,
    createElement: () => ({ getContext: () => null }),
  }
}
if (typeof global.window === 'undefined') {
  global.window = global
}
if (typeof global.HTMLCanvasElement === 'undefined') {
  global.HTMLCanvasElement = function HTMLCanvasElement() {}
}
if (typeof global.ImageData === 'undefined') {
  global.ImageData = function ImageData(data, w, h) {
    this.data = data
    this.width = w
    this.height = h
  }
}

function waitCv(timeoutMs = 120000) {
  // Require inside the waiter (same pattern as probeOpenCvApis.cjs).
  const cv = require('@techstark/opencv-js')
  return new Promise((resolve, reject) => {
    let settled = false
    const t = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('OpenCV init timeout'))
      }
    }, timeoutMs)
    const done = () => {
      if (settled) return
      if (typeof cv.Mat !== 'function') return
      settled = true
      clearTimeout(t)
      resolve(cv)
    }
    if (typeof cv.Mat === 'function') {
      done()
      return
    }
    if (typeof cv.then === 'function') {
      cv.then(() => done(), (err) => {
        if (!settled) {
          settled = true
          clearTimeout(t)
          reject(err)
        }
      })
    }
    const start = Date.now()
    const poll = setInterval(() => {
      if (typeof cv.Mat === 'function') {
        clearInterval(poll)
        done()
      } else if (Date.now() - start > timeoutMs - 1000) {
        clearInterval(poll)
      }
    }, 25)
  })
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
    if (d >= fgThresh || dark || (chromatic && d > bgThresh) || warm) seeds[i] = cv.GC_FGD
    else if (d <= bgThresh * 1.5 && (textured || L > bg.mean.L + 4)) seeds[i] = cv.GC_PR_FGD
    else if (d <= bgThresh * 1.1) seeds[i] = cv.GC_PR_BGD
    else seeds[i] = cv.GC_PR_FGD
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

function labelsToMask(labels, cv, labData, bgMean) {
  const data = new Uint8Array(labels.length)
  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i]
    if (lab === cv.GC_FGD || lab === cv.GC_PR_FGD) data[i] = 255
    else {
      const o = i * 3
      const d = labDist(
        { L: labData[o], a: labData[o + 1], b: labData[o + 2] },
        bgMean,
      )
      data[i] =
        lab === cv.GC_PR_BGD && d > 14 ? Math.min(160, Math.floor(40 + d * 4)) : 0
    }
  }
  return data
}

function seedsToMask(seeds, cv, labData, bgMean) {
  const data = new Uint8Array(seeds.length)
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
      if (v >= 200) mask[i] = Math.max(soft, Math.min(255, ((v + soft) / 2) | 0))
      else if (v <= 20 && soft > 40 && maxN >= 200) mask[i] = Math.min(180, soft)
    }
  }
}

function del(...mats) {
  for (const m of mats) if (m) try { m.delete() } catch (_) {}
}

async function main() {
  const [, , rgbaPath, wStr, hStr, outMaskPath, optionsArg] = process.argv
  if (!rgbaPath || !wStr || !hStr || !outMaskPath) {
    console.error(
      'usage: segmentOnce.cjs rgbaPath width height outMaskPath [optionsJson|options.json]',
    )
    process.exit(2)
  }
  const srcW = Number(wStr)
  const srcH = Number(hStr)
  let options = {}
  if (optionsArg) {
    if (optionsArg.endsWith('.json') && fs.existsSync(optionsArg)) {
      options = JSON.parse(fs.readFileSync(optionsArg, 'utf8'))
    } else {
      try {
        options = JSON.parse(optionsArg)
      } catch {
        options = {}
      }
    }
  }
  const maxWorkingSide = options.maxWorkingSide || 160
  const grabCutIters = options.grabCutIters || 2
  const forceSeedFallback = !!options.forceSeedFallback

  const t0 = Date.now()
  process.stderr.write('[segmentOnce] loading OpenCV…\n')
  const cv = await waitCv()
  process.stderr.write('[segmentOnce] OpenCV ready\n')
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
  // Prefer seed confidence at large working sizes — full-frame GrabCut in
  // OpenCV.js can hang/stall for minutes on product photos. Use GrabCut only
  // when the working canvas is modest.
  const grabCutBudget = workW * workH <= 180 * 180 && !forceSeedFallback
  if (typeof cv.grabCut === 'function' && grabCutBudget) {
    process.stderr.write(
      `[segmentOnce] grabCut ${workW}x${workH} iters=${grabCutIters}\n`,
    )
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
        Math.min(2, grabCutIters),
        cv.GC_INIT_WITH_MASK,
      )
      workMask = labelsToMask(gcMask.data, cv, labData, bg.mean)
      methodUsed = 'opencv-grabcut'
      process.stderr.write('[segmentOnce] grabCut ok\n')
    } catch (_) {
      workMask = seedsToMask(seeds, cv, labData, bg.mean)
      methodUsed = 'opencv-seed-fallback'
      process.stderr.write('[segmentOnce] grabCut failed → seeds\n')
    }
    del(gcMask, bgdModel, fgdModel)
  } else {
    process.stderr.write(
      `[segmentOnce] seed path ${workW}x${workH} (grabCutBudget=${grabCutBudget})\n`,
    )
    workMask = seedsToMask(seeds, cv, labData, bg.mean)
  }

  softenBoundary(workMask, labData, workW, workH, bg.mean)

  let finalMask = workMask
  if (workW !== srcW || workH !== srcH) {
    const small = cv.matFromArray(workH, workW, cv.CV_8UC1, workMask)
    const up = new cv.Mat()
    cv.resize(small, up, new cv.Size(srcW, srcH), 0, 0, cv.INTER_LINEAR)
    finalMask = new Uint8Array(up.data)
    del(small, up)
  }

  del(rgbaMat, rgbFull, labFull, resizedRgb, resizedLab)
  fs.writeFileSync(outMaskPath, Buffer.from(finalMask))
  process.stdout.write(
    JSON.stringify({
      ok: true,
      methodUsed,
      elapsedMs: Date.now() - t0,
      workingWidth: workW,
      workingHeight: workH,
    }) + '\n',
  )
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }) +
      '\n',
  )
  process.exit(1)
})
