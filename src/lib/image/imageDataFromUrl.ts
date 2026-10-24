import { loadHtmlImage } from './loadHtmlImage'

/**
 * Decode an object URL / image URL into ImageData for local segmentation.
 * Does not mutate the source file; creates a temporary canvas snapshot.
 */
export async function imageDataFromObjectUrl(
  objectUrl: string,
  expectedWidth?: number,
  expectedHeight?: number,
): Promise<ImageData> {
  const image = await loadHtmlImage(objectUrl)
  const width = expectedWidth ?? image.naturalWidth
  const height = expectedHeight ?? image.naturalHeight
  if (width < 1 || height < 1) {
    throw new Error('Invalid image dimensions for auto-mask.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Could not create a 2D canvas context for auto-mask.')
  }
  ctx.drawImage(image, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}
