import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { PNG } from "pngjs"
import jpeg from "jpeg-js"

const files = [
  "05_coat-result.png","06_sweater-result.png","07_dress-result.png",
  "08_sneakers-result.png","09_handbag-result.png","10_cap-result.png",
]
mkdirSync("tmp-client-zip-review", { recursive: true })
for (const f of files) {
  const buf = readFileSync(`tmp-client-zip-review/${f}`)
  const png = PNG.sync.read(buf)
  let a255=0,a0=0,apart=0, beigeish=0, magentaish=0, nearWhite=0
  const corner = []
  for (let i=0;i<4;i++) corner.push([png.data[i*4],png.data[i*4+1],png.data[i*4+2],png.data[i*4+3]])
  // sample top-left 5x5 mean
  let sr=0,sg=0,sb=0,n=0
  for (let y=0;y<5;y++) for (let x=0;x<5;x++) {
    const o=(y*png.width+x)*4
    sr+=png.data[o]; sg+=png.data[o+1]; sb+=png.data[o+2]; n++
  }
  for (let i=0;i<png.width*png.height;i++) {
    const o=i*4
    const a=png.data[o+3]
    if (a===255) a255++; else if (a===0) a0++; else apart++
    const r=png.data[o],g=png.data[o+1],b=png.data[o+2]
    if (Math.abs(r-232)<25 && Math.abs(g-220)<25 && Math.abs(b-200)<30) beigeish++
    if (r>240 && g<20 && b>240) magentaish++
    if (r>210 && g>210 && b>210 && Math.max(r,g,b)-Math.min(r,g,b)<18) nearWhite++
  }
  const total=png.width*png.height
  console.log(JSON.stringify({
    f, w:png.width, h:png.height,
    a255:+(a255/total).toFixed(4), a0:+(a0/total).toFixed(4), apart:+(apart/total).toFixed(4),
    beigeish:+(beigeish/total).toFixed(4), magentaish:+(magentaish/total).toFixed(4),
    nearWhite:+(nearWhite/total).toFixed(4),
    tlMean:[Math.round(sr/n),Math.round(sg/n),Math.round(sb/n)],
  }))
}
