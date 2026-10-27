/**
 * Pixel-level WebGPU vs WASM compare on the rewritten graph (browser).
 * Reports IoU / false removal / bg leakage vs WASM rewrite reference.
 */
import { createServer } from 'node:http'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { BIREFNET_METHOD } from '../../src/lib/mask/birefNet/constants'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const distDir = join(root, 'dist')
const rewritePath = join(
  root,
  'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28/model_fp16.gathernd_rewrite.onnx',
)
const outDir = join(root, 'tmp-model-eval/birefnet-webgpu-rewrite-2026-10-28')
const REWRITE_URL = '/experiments/birefnet-webgpu-rewrite/model_fp16.gathernd_rewrite.onnx'
const harnessName = 'birefnet-rewrite-compare-harness.html'

const FIXTURES = [
  { id: 'dark-hoodie', rel: 'testdata/clothing/01_hoodie.jpg' },
  { id: 'white-tshirt', rel: 'testdata/clothing/03_tshirt.jpg' },
  { id: 'white-sneakers', rel: 'testdata/clothing/08_sneakers.jpg' },
  { id: 'open-handbag', rel: 'testdata/clothing/09_handbag.jpg' },
  { id: 'polo-carpet-closeup', rel: 'testdata/clothing/polo-5.png' },
]

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
}

const HARNESS = `<!doctype html><html><body><pre id="out">…</pre>
<script type="module">
const params = new URLSearchParams(location.search)
const modelUrl = params.get('model')
const fixtures = (params.get('fixtures')||'').split(',').filter(Boolean)
const SIZE=512, MEAN=[0.485,0.456,0.406], STD=[0.229,0.224,0.225]
function report(o){ window.__CMP__=o; document.getElementById('out').textContent=JSON.stringify(o,null,2) }
async function decode(path){
  const bmp=await createImageBitmap(await (await fetch(path)).blob())
  const c=document.createElement('canvas'); c.width=bmp.width; c.height=bmp.height
  const ctx=c.getContext('2d'); ctx.drawImage(bmp,0,0)
  const id=ctx.getImageData(0,0,c.width,c.height); bmp.close?.(); return id
}
function preprocess(imageData){
  const tensor=new Float32Array(3*SIZE*SIZE)
  const {width:srcW,height:srcH,data}=imageData
  const sample=(x,y,c)=>{
    const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(srcW-1,x0+1),y1=Math.min(srcH-1,y0+1)
    const fx=x-x0,fy=y-y0, at=(xx,yy)=>data[(yy*srcW+xx)*4+c]
    return at(x0,y0)*(1-fx)*(1-fy)+at(x1,y0)*fx*(1-fy)+at(x0,y1)*(1-fx)*fy+at(x1,y1)*fx*fy
  }
  for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
    const sx=Math.min(srcW-1,Math.max(0,(x+0.5)*(srcW/SIZE)-0.5))
    const sy=Math.min(srcH-1,Math.max(0,(y+0.5)*(srcH/SIZE)-0.5))
    for(let c=0;c<3;c++) tensor[c*SIZE*SIZE+y*SIZE+x]=(sample(sx,sy,c)/255-MEAN[c])/STD[c]
  }
  return tensor
}
function keepMask(logits){
  const m=new Uint8Array(SIZE*SIZE)
  for(let i=0;i<m.length;i++){
    const v=logits[i], p=1/(1+Math.exp(-Math.min(50,Math.max(-50,v))))
    m[i]=Math.round(p*255)>=128?255:0
  }
  return m
}
function metrics(ref,hyp){
  let inter=0,union=0,fr=0,bl=0,edge=0
  for(let i=0;i<ref.length;i++){
    const r=ref[i]===255,h=hyp[i]===255
    if(r||h) union++; if(r&&h) inter++; if(r&&!h) fr++; if(!r&&h) bl++
  }
  // edge: disagreeing pixels adjacent to a KEEP in either mask
  for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
    const i=y*SIZE+x
    if(ref[i]===hyp[i]) continue
    let near=false
    for(let dy=-1;dy<=1&&!near;dy++) for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy
      if(xx<0||yy<0||xx>=SIZE||yy>=SIZE) continue
      const j=yy*SIZE+xx
      if(ref[j]===255||hyp[j]===255){ near=true }
    }
    if(near) edge++
  }
  return {
    iou: union===0?1:inter/union,
    falseGarmentRemovalPct: +(100*fr/ref.length).toFixed(4),
    backgroundLeakagePct: +(100*bl/ref.length).toFixed(4),
    edgeArtifactPx: edge,
    keepRef: ref.reduce((a,v)=>a+(v===255),0)/ref.length,
    keepHyp: hyp.reduce((a,v)=>a+(v===255),0)/ref.length,
  }
}
async function makeSession(ortMod, providers){
  const sess=await ortMod.InferenceSession.create(modelUrl,{executionProviders:providers,graphOptimizationLevel:'all'})
  const inName=sess.inputNames.includes('input_image')?'input_image':sess.inputNames[0]
  const outName=sess.outputNames.includes('output_image')?'output_image':sess.outputNames[0]
  return {sess, inName, outName}
}
async function infer(handle, ortMod, path){
  const image=await decode(path)
  const tensor=preprocess(image)
  const out=await handle.sess.run({[handle.inName]:new ortMod.Tensor('float32',tensor,[1,3,SIZE,SIZE])})
  const logits=out[handle.outName].data
  return {mask:keepMask(logits), logits}
}
try{
  const wasmOrt=await import('/ort-vendor/ort.min.mjs')
  if(wasmOrt.env?.wasm){ wasmOrt.env.wasm.wasmPaths='/ort-vendor/'; wasmOrt.env.wasm.numThreads=1 }
  const gpuOrt=await import('/ort-vendor/ort.webgpu.min.mjs')
  if(gpuOrt.env?.wasm){ gpuOrt.env.wasm.wasmPaths='/ort-vendor/'; gpuOrt.env.wasm.numThreads=1 }
  const wasmS=await makeSession(wasmOrt,['wasm'])
  const gpuS=await makeSession(gpuOrt,['webgpu'])
  const rows=[]
  for(const path of fixtures){
    const a=await infer(wasmS,wasmOrt,path)
    const b=await infer(gpuS,gpuOrt,path)
    let max=0, sum=0
    for(let i=0;i<a.logits.length;i++){ const d=Math.abs(a.logits[i]-b.logits[i]); if(d>max)max=d; sum+=d }
    const m=metrics(a.mask,b.mask)
    rows.push({path, logitMaxAbsDiff:+max.toFixed(6), logitMeanAbsDiff:+(sum/a.logits.length).toFixed(6), exactMask:m.iou===1&&m.falseGarmentRemovalPct===0&&m.backgroundLeakagePct===0, ...m})
  }
  if(typeof wasmS.sess.release==='function') await wasmS.sess.release()
  if(typeof gpuS.sess.release==='function') await gpuS.sess.release()
  report({ok:rows.every(r=>r.keepHyp>0.02&&r.iou>=0.99), equivalenceClass: rows.every(r=>r.exactMask)?'exact':'acceptable-measured-deviation', rows})
}catch(e){ report({ok:false,error:String(e&&e.message||e)}) }
</script></body></html>`

async function main() {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(distDir, harnessName), HARNESS)

  const clothingSrc = join(root, 'public/testdata/clothing')
  const clothingDist = join(distDir, 'testdata/clothing')
  mkdirSync(clothingDist, { recursive: true })
  for (const name of [
    '01_hoodie.jpg',
    '03_tshirt.jpg',
    '08_sneakers.jpg',
    '09_handbag.jpg',
  ]) {
    copyFileSync(join(clothingSrc, name), join(clothingDist, name))
  }
  const polo = join(
    root,
    'tmp-model-eval/polo-carpet-hw-accel-2026-10-28/sources/polo-5.png',
  )
  if (existsSync(polo)) copyFileSync(polo, join(clothingDist, 'polo-5.png'))

  const rewriteBytes = readFileSync(rewritePath)
  const port = 5185
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
    let rel = decodeURIComponent(url.pathname)
    if (rel === REWRITE_URL) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(rewriteBytes.length),
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      })
      res.end(rewriteBytes)
      return
    }
    const filePath = join(distDir, rel.replace(/^\//, ''))
    if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
      res.writeHead(404)
      res.end('nf')
      return
    }
    const body = readFileSync(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Content-Length': String(body.length),
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    })
    res.end(body)
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--enable-unsafe-webgpu'],
  })
  const page = await browser.newPage()
  const qs = new URLSearchParams({
    model: REWRITE_URL,
    fixtures: FIXTURES.map((f) => `/${f.rel}`).join(','),
    method: BIREFNET_METHOD,
  })
  await page.goto(`http://127.0.0.1:${port}/${harnessName}?${qs}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  })
  const handle = await page.waitForFunction('window.__CMP__', null, {
    timeout: 900_000,
  })
  const report = await handle.jsonValue()
  await browser.close()
  server.close()
  writeFileSync(
    join(outDir, 'webgpu-vs-wasm-compare.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify(report, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
