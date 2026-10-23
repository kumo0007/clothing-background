import { loadOpenCv } from '../src/lib/mask/opencv/loadOpenCv'

console.log('loading…')
const t0 = Date.now()
const cv = await loadOpenCv()
console.log('loaded in', Date.now() - t0, 'ms Mat=', typeof cv.Mat, 'grabCut=', typeof cv.grabCut)
