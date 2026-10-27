/**
 * Ambient typings for onnxruntime-web.
 * Package ships types.d.ts but package.json "exports" does not expose them
 * under bundler resolution, so TypeScript cannot resolve the module otherwise.
 */
declare module 'onnxruntime-web' {
  export type TensorType =
    | 'float32'
    | 'float16'
    | 'int32'
    | 'int64'
    | 'uint8'
    | 'bool'
    | string

  export class Tensor {
    constructor(
      type: TensorType,
      data: Float32Array | Uint8Array | Int32Array | BigInt64Array | number[],
      dims?: readonly number[],
    )
    readonly type: TensorType
    readonly data: Float32Array | Uint8Array | Int32Array | BigInt64Array | unknown
    readonly dims: readonly number[]
  }

  export interface InferenceSession {
    readonly inputNames: readonly string[]
    readonly outputNames: readonly string[]
    run(
      feeds: Record<string, Tensor>,
      options?: Record<string, unknown>,
    ): Promise<Record<string, Tensor>>
    release?(): Promise<void>
  }

  export namespace InferenceSession {
    function create(
      uri: string | ArrayBufferLike | Uint8Array,
      options?: {
        executionProviders?: string[]
        graphOptimizationLevel?: string
        [key: string]: unknown
      },
    ): Promise<InferenceSession>
  }

  export const env: {
    wasm?: {
      numThreads?: number
      simd?: boolean
      proxy?: boolean
      [key: string]: unknown
    }
    [key: string]: unknown
  }

  const ort: {
    Tensor: typeof Tensor
    InferenceSession: typeof InferenceSession & {
      create: typeof InferenceSession.create
    }
    env: typeof env
  }

  export default ort
}
