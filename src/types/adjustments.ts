/** Normalized crop rectangle in image space (0–1). */
export type CropRect = {
  x: number
  y: number
  width: number
  height: number
}

export type RotationDegrees = 0 | 90 | 180 | 270

/** How the composited result is fit into a fixed export canvas (Phase 7). */
export type OutputFitMode = 'contain' | 'cover' | 'stretch'

/**
 * Per-image presentation settings (Phases 3–8).
 * Applied after mask compositing; never invents garment pixels.
 */
export type ImageAdjustments = {
  brightness: number
  contrast: number
  saturation: number
  /** Cardinal orientation (0 / 90 / 180 / 270). */
  rotation: RotationDegrees
  /**
   * Subtle catalog tilt in degrees (−15…15), applied on top of rotation.
   * Client request: slight rotation without regenerating the garment.
   */
  tilt: number
  flipHorizontal: boolean
  flipVertical: boolean
  /** Horizontal skew in degrees (−45…45). */
  skewX: number
  /** Vertical skew in degrees (−45…45). */
  skewY: number
  /** null = no crop (full image). */
  crop: CropRect | null
  /** Frame width in pixels (client “Frame” feature). */
  borderWidth: number
  borderColor: string
  /**
   * Fixed export canvas width/height. null = keep native pipeline size.
   * Applied last (after border).
   */
  outputWidth: number | null
  outputHeight: number | null
  outputFit: OutputFitMode
  /** Letterbox/pillarbox fill when outputFit is "contain". */
  outputPadColor: string
  /**
   * Soft drop / contact shadow from the KEEP mask silhouette (Phase 8).
   * Opacity 0 disables. Requires a mask; skipped otherwise.
   */
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowOpacity: number
  shadowColor: string
}

export type ShadowPreset = {
  id: string
  label: string
  blur: number
  offsetX: number
  offsetY: number
  opacity: number
}

/** Catalog-friendly Canvas shadows (no AI). Dual-layer soft contact in renderer. */
export const SHADOW_PRESETS: ShadowPreset[] = [
  { id: 'off', label: 'Off', blur: 0, offsetX: 0, offsetY: 0, opacity: 0 },
  {
    id: 'contact',
    label: 'Soft contact',
    blur: 24,
    offsetX: 0,
    offsetY: 8,
    opacity: 36,
  },
  {
    id: 'drop',
    label: 'Drop',
    blur: 20,
    offsetX: 6,
    offsetY: 12,
    opacity: 40,
  },
  {
    id: 'long',
    label: 'Long',
    blur: 36,
    offsetX: 12,
    offsetY: 20,
    opacity: 30,
  },
]

export type OutputSizePreset = {
  id: string
  label: string
  width: number | null
  height: number | null
}

/** Common catalog canvas sizes (null = original / no resize). */
export const OUTPUT_SIZE_PRESETS: OutputSizePreset[] = [
  { id: 'original', label: 'Original', width: null, height: null },
  { id: '1000', label: '1000×1000', width: 1000, height: 1000 },
  { id: '1200', label: '1200×1200', width: 1200, height: 1200 },
  { id: '800x1000', label: '800×1000', width: 800, height: 1000 },
  { id: '2000', label: '2000×2000', width: 2000, height: 2000 },
]

export function createDefaultAdjustments(): ImageAdjustments {
  return {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    rotation: 0,
    tilt: 0,
    flipHorizontal: false,
    flipVertical: false,
    skewX: 0,
    skewY: 0,
    crop: null,
    borderWidth: 0,
    borderColor: '#000000',
    outputWidth: null,
    outputHeight: null,
    outputFit: 'contain',
    outputPadColor: '#FFFFFF',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowOpacity: 0,
    shadowColor: '#000000',
  }
}

export function clampShadowBlur(value: number): number {
  return Math.min(64, Math.max(0, Math.round(value)))
}

export function clampShadowOffset(value: number): number {
  return Math.min(48, Math.max(-48, Math.round(value)))
}

export function clampShadowOpacity(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function clampOutputDimension(value: number): number {
  return Math.min(4096, Math.max(64, Math.round(value)))
}

export function clampSkewDegrees(value: number): number {
  return clampAdjustValue(value, -45, 45)
}

/** Subtle product tilt for catalog variety (−15…15). */
export function clampTiltDegrees(value: number): number {
  return Math.min(15, Math.max(-15, Math.round(value)))
}

export function clampAdjustValue(value: number, min = -100, max = 100): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeCrop(crop: CropRect): CropRect {
  const x = Math.min(1, Math.max(0, crop.x))
  const y = Math.min(1, Math.max(0, crop.y))
  const width = Math.min(1 - x, Math.max(0.05, crop.width))
  const height = Math.min(1 - y, Math.max(0.05, crop.height))
  return { x, y, width, height }
}
