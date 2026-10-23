declare module '@imgly/background-removal-node' {
  export type Config = {
    publicPath?: string
    debug?: boolean
    proxyToWorker?: boolean
    model?: 'small' | 'medium' | 'large'
    output?: {
      format?:
        | 'image/png'
        | 'image/jpeg'
        | 'image/webp'
        | 'image/x-rgba8'
        | 'image/x-alpha8'
      quality?: number
      type?: 'foreground' | 'background' | 'mask'
    }
    progress?: (key: string, current: number, total: number) => void
  }
  export type ImageSource =
    | string
    | URL
    | Buffer
    | ArrayBuffer
    | Uint8Array
    | Blob
  export function removeBackground(
    image: ImageSource,
    configuration?: Config,
  ): Promise<Blob | Buffer>
  export function removeForeground(
    image: ImageSource,
    configuration?: Config,
  ): Promise<Blob>
  export function segmentForeground(
    image: ImageSource,
    configuration?: Config,
  ): Promise<Blob>
  export default removeBackground
}

declare module '@imgly/background-removal' {
  export type Config = {
    publicPath?: string
    debug?: boolean
    device?: 'cpu' | 'gpu'
    model?: 'isnet' | 'isnet_fp16' | 'isnet_quint8'
    output?: {
      format?: 'image/png' | 'image/jpeg' | 'image/webp'
      quality?: number
      type?: 'foreground' | 'background' | 'mask'
    }
    progress?: (key: string, current: number, total: number) => void
  }
  export function removeBackground(
    image: unknown,
    configuration?: Config,
  ): Promise<Blob>
  export function preload(configuration?: Config): Promise<void>
  const _default: typeof removeBackground
  export default _default
}
