const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/x-ms-bmp',
  'image/heic',
  'image/heif',
])

/**
 * `<input accept>` for iPhone Safari Photo Library.
 * Keep this to `image/*` only — adding `.heic`/MIME lists can make iOS
 * refuse to open the picker sheet. Client-side still filters / sniffs types.
 */
export const IMAGE_FILE_ACCEPT = 'image/*'

function displayNameForFile(file: File, index: number): string {
  const trimmed = (file.name || '').trim()
  if (trimmed) return trimmed
  return `photo-${index + 1}`
}

/** Sniff common image containers when iOS omits MIME / extension. */
export function sniffImageMime(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  // ISO BMFF (HEIC/HEIF): ....ftyp....
  if (bytes.length >= 12) {
    const brand = String.fromCharCode(
      bytes[4],
      bytes[5],
      bytes[6],
      bytes[7],
    )
    if (brand === 'ftyp') {
      const major = String.fromCharCode(
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
      ).toLowerCase()
      if (
        major.startsWith('hei') ||
        major === 'mif1' ||
        major === 'msf1' ||
        major === 'hevc'
      ) {
        return 'image/heic'
      }
    }
  }
  return ''
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
    case 'image/pjpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/bmp':
    case 'image/x-ms-bmp':
      return 'bmp'
    case 'image/heic':
      return 'heic'
    case 'image/heif':
      return 'heif'
    default:
      return 'jpg'
  }
}

/**
 * Copy gallery File bytes into a heap-resident File immediately.
 *
 * iOS Safari Photo Library Files are backed by a temporary sandbox path.
 * `URL.createObjectURL(file)` does not copy bytes — when that path is
 * revoked (or never resolvable), decode / later reads fail with empty
 * payloads. Reading `arrayBuffer()` in the same turn materializes bytes.
 */
export async function materializePickedFile(
  file: File,
  index = 0,
): Promise<File> {
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    throw new Error(
      `Could not read photo bytes (iOS gallery path unavailable): ${displayNameForFile(file, index)}`,
    )
  }
  if (buffer.byteLength === 0) {
    throw new Error(
      `Photo had 0 bytes after pick (gallery path revoked): ${displayNameForFile(file, index)}`,
    )
  }

  const sniffed = sniffImageMime(buffer)
  const type =
    (file.type || '').toLowerCase() ||
    sniffed ||
    (isHeicLikeFile(file) ? 'image/heic' : 'image/jpeg')

  let name = (file.name || '').trim()
  if (!name || !/\.[a-z0-9]+$/i.test(name)) {
    name = `photo-${index + 1}.${extensionForMime(type)}`
  }

  return new File([buffer], name, {
    type,
    lastModified: file.lastModified || Date.now(),
  })
}

export async function materializePickedFiles(files: File[]): Promise<{
  files: File[]
  failures: string[]
}> {
  const out: File[] = []
  const failures: string[] = []
  for (let i = 0; i < files.length; i += 1) {
    try {
      out.push(await materializePickedFile(files[i], i))
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error.message
          : `Could not read ${displayNameForFile(files[i], i)}`,
      )
    }
  }
  return { files: out, failures }
}

export function isHeicLikeFile(file: File): boolean {
  if (/image\/hei[cf]/i.test(file.type)) return true
  return /\.hei[cf]$/i.test(file.name)
}

export function isAcceptedImageFile(file: File): boolean {
  const type = (file.type || '').toLowerCase()
  if (type && ACCEPTED_MIME_TYPES.has(type)) {
    return true
  }
  // Any image/* from the Photos sheet (incl. odd aliases).
  if (type.startsWith('image/')) {
    return true
  }

  // Some browsers omit MIME for certain extensions; fall back to extension.
  if (/\.(jpe?g|png|webp|gif|bmp|hei[cf])$/i.test(file.name)) {
    return true
  }

  // iOS Photo Library often returns empty type + empty / extension-less name.
  // Attempt decode; materialize + sniff will classify bytes.
  if (!type && file.size > 0 && !/\.[a-z0-9]{1,8}$/i.test(file.name || '')) {
    return true
  }

  return false
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

async function loadImageDimensionsFromBitmap(
  source: Blob,
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('createImageBitmap unavailable')
  }
  const bitmap = await createImageBitmap(source)
  try {
    if (bitmap.width < 1 || bitmap.height < 1) {
      throw new Error('zero dimensions')
    }
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

function loadImageDimensionsFromElement(
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

/**
 * Prefer createImageBitmap(blob) so decode never depends on a gallery path.
 * Fall back to Image + object URL for older engines.
 */
export async function loadImageDimensions(
  source: string | Blob,
): Promise<{ width: number; height: number }> {
  if (typeof source !== 'string') {
    try {
      return await loadImageDimensionsFromBitmap(source)
    } catch {
      const objectUrl = URL.createObjectURL(source)
      try {
        return await loadImageDimensionsFromElement(objectUrl)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }
  return loadImageDimensionsFromElement(source)
}

export function createImageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
