const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
])

export function isAcceptedImageFile(file: File): boolean {
  if (ACCEPTED_MIME_TYPES.has(file.type)) {
    return true
  }

  // Some browsers omit MIME for certain extensions; fall back to extension.
  return /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)
}

export function filterImageFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter(isAcceptedImageFile)
}

export function loadImageDimensions(
  objectUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      reject(new Error('Failed to load image'))
    }
    image.src = objectUrl
  })
}

export function createImageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
