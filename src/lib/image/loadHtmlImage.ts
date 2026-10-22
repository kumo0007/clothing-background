export function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    image.src = url
  })
}

export const BACKGROUND_ACCEPT =
  'image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp'

export function isBackgroundImageFile(file: File): boolean {
  if (
    file.type === 'image/jpeg' ||
    file.type === 'image/png' ||
    file.type === 'image/webp'
  ) {
    return true
  }
  return /\.(jpe?g|png|webp)$/i.test(file.name)
}
