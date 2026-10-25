import ort from 'onnxruntime-web'

const session = await ort.InferenceSession.create(
  'tmp-model-eval/weights/u2netp.onnx',
)
const N = 1
const C = 3
const H = 320
const W = 320
const data = new Float32Array(N * C * H * W)
for (let i = 0; i < data.length; i += 1) data[i] = 0.5
const tensor = new ort.Tensor('float32', data, [N, C, H, W])
const t0 = Date.now()
const out = await session.run({ 'input.1': tensor })
console.log('inferMs', Date.now() - t0)
for (const name of session.outputNames) {
  const t = out[name]
  let min = Infinity
  let max = -Infinity
  const arr = t.data
  for (let i = 0; i < Math.min(arr.length, 5000); i += 1) {
    const v = arr[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  console.log(name, t.dims, 'sampleMinMax', min, max)
}
