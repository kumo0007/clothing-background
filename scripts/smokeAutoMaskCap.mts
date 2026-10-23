import { readFileSync } from "node:fs"
import jpeg from "jpeg-js"
import { runAutoMaskPipeline } from "../src/lib/mask/autoMaskPipeline"

const raw = readFileSync("public/testdata/clothing/10_cap.jpg")
const d = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true })
const imageData = {
  width: d.width,
  height: d.height,
  data: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength),
  colorSpace: "srgb",
}
const t0 = Date.now()
const result = await runAutoMaskPipeline(imageData as ImageData, "auto")
console.log({ method: result.methodUsed, ms: Date.now() - t0, elapsed: result.elapsedMs })
