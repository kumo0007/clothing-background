import type { ImageAdjustments } from './adjustments'
import type { BackgroundState } from './background'
import type { MaskStateMeta } from './mask'

/** Phase 1 uploaded image fields (preserved). */
export type UploadedImage = {
  id: string
  file: File
  name: string
  objectUrl: string
  width: number
  height: number
}

/** Per-image Phase 2 + Phase 3 project fields. */
export type ImageProjectExtras = {
  background: BackgroundState
  maskMeta: MaskStateMeta
  adjustments: ImageAdjustments
}

export type ImageProject = UploadedImage & ImageProjectExtras
