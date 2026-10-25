const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
])

export function isHeicLikeFile(file: File): boolean {
  if (/image\/hei[cf]/i.test(file.type)) return true
  return /\.hei[cf]$/i.test(file.name)
}

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

/**
 * Files to attempt decode: standard formats plus HEIC/HEIF candidates.
 * Chrome typically cannot decode HEIC; Safari often can via HTMLImageElement.
 * No WASM converter is bundled — failed HEIC still gets conversion guidance.
 */
export function filesToAttemptDecode(files: FileList | File[]): File[] {
  const list = Array.from(files)
  const primary = filterImageFiles(list)
  const heicExtras = list.filter(
    (file) => isHeicLikeFile(file) && !isAcceptedImageFile(file),
  )
  return [...primary, ...heicExtras]
}

/** Explain why selected files were rejected (esp. iPhone HEIC). */
export function describeRejectedImageFiles(files: FileList | File[]): string | null {
  const list = Array.from(files)
  if (list.length === 0) return null
  const accepted = filterImageFiles(list)
  if (accepted.length > 0) return null
  const heicCount = list.filter(isHeicLikeFile).length
  if (heicCount > 0) {
    return `iPhone HEIC/HEIF could not be decoded in this browser (${heicCount} file${
      heicCount === 1 ? '' : 's'
    }). Export as JPEG (Photos → File → Export → Most Compatible, or Camera → Formats → Most Compatible), then re-upload. A WASM HEIC converter is not bundled (memory / compatibility cost).`
  }
  return 'No supported image files were selected. Use JPEG, PNG, WebP, GIF, or BMP.'
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
