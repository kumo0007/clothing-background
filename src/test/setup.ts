import '@testing-library/jest-dom/vitest'

// jsdom does not always provide ImageData; mask rendering helpers need it.
if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray
    readonly width: number
    readonly height: number
    readonly colorSpace = 'srgb'

    constructor(
      dataOrWidth: Uint8ClampedArray | number,
      widthOrHeight: number,
      maybeHeight?: number,
    ) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth
        this.height = widthOrHeight
        this.data = new Uint8ClampedArray(this.width * this.height * 4)
      } else {
        this.data = dataOrWidth
        this.width = widthOrHeight
        this.height = maybeHeight ?? 0
      }
    }
  }

  globalThis.ImageData =
    ImageDataPolyfill as unknown as typeof ImageData
}
