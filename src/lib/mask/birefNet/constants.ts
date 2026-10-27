/**
 * BiRefNet_lite 512×512 (browser ONNX) — MIT-licensed weights.
 *
 * Upstream: ZhengPeng7/BiRefNet (https://github.com/ZhengPeng7/BiRefNet)
 * Browser export: studioludens/birefnet-lite-512 (fp16 ~94 MB)
 *
 * Commercial note: model/code are MIT. Training data includes DIS5K which has
 * its own dataset terms — review DIS5K licensing for commercial products.
 */

export const BIREFNET_METHOD = 'birefnet-lite-512'
export const BIREFNET_PROVIDER = 'birefnet-onnx'
export const BIREFNET_HF_REPO = 'studioludens/birefnet-lite-512'
export const BIREFNET_INPUT_SIZE = 512

/** Same-origin mirror under Vite `public/`. */
export const BIREFNET_PUBLIC_BASE = `/models/${BIREFNET_HF_REPO}`
export const BIREFNET_ONNX_FP16_PATH = `${BIREFNET_PUBLIC_BASE}/onnx/model_fp16.onnx`
export const BIREFNET_ONNX_FP32_PATH = `${BIREFNET_PUBLIC_BASE}/onnx/model.onnx`

/**
 * Git LFS pointer for onnx/model_fp16.onnx at commit
 * 962e67969ec6acec9c19fab76acee4f5e22e990c (studioludens/birefnet-lite-512).
 */
export const BIREFNET_ONNX_FP16_BYTES = 98_484_532
export const BIREFNET_ONNX_FP16_SHA256 =
  'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516'

export const BIREFNET_INPUT_NAME = 'input_image'
export const BIREFNET_OUTPUT_NAME = 'output_image'

/** ImageNet normalization used by BiRefNet preprocessor. */
export const BIREFNET_MEAN = [0.485, 0.456, 0.406] as const
export const BIREFNET_STD = [0.229, 0.224, 0.225] as const

export const BIREFNET_PRELOAD_IDLE_MS = 180_000
export const BIREFNET_PRELOAD_MAX_MS = 600_000
export const BIREFNET_INFER_TIMEOUT_MS = 120_000
