import { zipSync } from 'fflate'
import type { ExportFormat } from '../export/exportImage'
import { buildExportFilename, canvasToBlob } from '../export/exportImage'
import {
  renderProjectCanvas,
  type ProjectRenderInput,
} from './renderProjectCanvas'

export type ZipExportProgress = {
  current: number
  total: number
  fileName: string
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer()
  return new Uint8Array(buffer)
}

export async function buildResultsZip(
  projects: ProjectRenderInput[],
  format: ExportFormat,
  onProgress?: (progress: ZipExportProgress) => void,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}
  const usedNames = new Set<string>()

  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index]
    onProgress?.({
      current: index + 1,
      total: projects.length,
      fileName: project.image.name,
    })

    const canvas = await renderProjectCanvas(project)
    const blob = await canvasToBlob(canvas, format)
    let name = buildExportFilename(project.image.name, format)
    if (usedNames.has(name)) {
      const stem = name.replace(/\.(png|jpg)$/i, '')
      const ext = format === 'jpeg' ? 'jpg' : 'png'
      name = `${stem}-${index + 1}.${ext}`
    }
    usedNames.add(name)
    files[name] = await blobToUint8Array(blob)
  }

  const zipped = zipSync(files, { level: 6 })
  // Copy into a fresh ArrayBuffer-backed view for Blob Part compatibility.
  const copy = new Uint8Array(zipped.byteLength)
  copy.set(zipped)
  return new Blob([copy.buffer], { type: 'application/zip' })
}

export function downloadBlob(blob: Blob, filename: string): void {
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
