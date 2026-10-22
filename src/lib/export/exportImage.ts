export type ExportFormat = 'png' | 'jpeg'

export function buildExportFilename(
  originalName: string,
  format: ExportFormat,
): string {
  const base = originalName.replace(/\.[^.]+$/, '') || 'garment'
  const safe = base.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'garment'
  return `${safe}-result.${format === 'jpeg' ? 'jpg' : 'png'}`
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  quality = 0.92,
): Promise<Blob> {
  const type = format === 'jpeg' ? 'image/jpeg' : 'image/png'
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode image'))
          return
        }
        resolve(blob)
      },
      type,
      format === 'jpeg' ? quality : undefined,
    )
  })
}

export async function downloadCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
  format: ExportFormat,
): Promise<void> {
  const blob = await canvasToBlob(canvas, format)
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
