import { loadHtmlImage } from '../image/loadHtmlImage'
import { setMask } from '../mask/maskStore'
import type { BirefNetProgress } from '../mask/birefNet'
import type { MaskDiagnosticSummary } from '../../types/mask'
import {
  estimateImageBuffersBytes,
  logSafariDiag,
} from '../diagnostics/safariBatchDiagnostics'

/** Sole automatic segmentation backend for Batch auto-mask. */
export type AutoMaskBackend = 'birefnet'

export type AutoMaskProgress = BirefNetProgress

/**
 * Auto-mask one image with browser-local BiRefNet_lite 512 and commit the KEEP
 * alpha mask to `maskStore`. Original upload RGB is left untouched.
 *
 * BiRefNet is the only automatic backend. Failures surface as thrown errors —
 * there is no silent fallback to RMBG, ISNet, Lab-seed, or other engines.
 */
export type AutoMaskCornersResult = {
  confidence: number
  needsReview: boolean
  requestedMethod: AutoMaskBackend
  methodUsed: string
  genuineModelInference: true
  reviewReason?: string
  diagnosticSummary?: MaskDiagnosticSummary
  device?: 'webgpu' | 'wasm' | 'unknown'
}

function toSummary(
  diagnostics: import('../mask/diagnostics/types').MaskDiagnostics,
): MaskDiagnosticSummary {
  return {
    reviewProfile: diagnostics.reviewProfile,
    heuristicScore: diagnostics.heuristicScore,
    score: diagnostics.heuristicScore,
    ruleIds: diagnostics.findings.map((f) => f.ruleId),
    findings: diagnostics.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      message: f.message,
      measuredValue: f.measuredValue,
      threshold: f.threshold,
      unit: f.unit,
      affectedRegion: f.affectedRegion,
      suggestedAction: f.suggestedAction,
    })),
  }
}

/**
 * Prefer the original File/Blob. Never `fetch(blob:…)` — Firefox and iOS
 * WebKit throw `NetworkError when attempting to fetch resource` for blob
 * URLs even when `<img src>` still displays them.
 */
async function resolveSourceImageBlob(
  objectUrl: string,
  width: number,
  height: number,
  sourceFile?: Blob | null,
): Promise<Blob> {
  if (sourceFile && sourceFile.size > 0) {
    return sourceFile
  }

  // Fallback only when File is missing: one HTMLImage → canvas → PNG.
  // Production Batch always passes image.file, so this path is rare.
  const img = await loadHtmlImage(objectUrl)
  const w = img.naturalWidth || img.width || width
  const h = img.naturalHeight || img.height || height
  if (w < 1 || h < 1) {
    throw new Error('Could not read the uploaded image for local auto-mask.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Could not read the uploaded image for local auto-mask.')
  }
  ctx.drawImage(img, 0, 0)
  const encoded = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
  if (!encoded || encoded.size < 1) {
    throw new Error(
      'Could not encode the uploaded image for local auto-mask. Re-add the photo and retry.',
    )
  }
  return encoded
}

export async function autoMaskCornersForImage(
  imageId: string,
  objectUrl: string,
  width: number,
  height: number,
  _tolerance = 40,
  onProgress?: (event: AutoMaskProgress) => void,
  sourceFile?: Blob | null,
  /** @deprecated Ignored — BiRefNet is the only automatic backend. */
  _preferredBackend: AutoMaskBackend = 'birefnet',
): Promise<AutoMaskCornersResult> {
  const est = estimateImageBuffersBytes(width, height)
  logSafariDiag('memory_estimate', 'before segment', {
    imageId,
    width,
    height,
    rgbaBytes: est.rgbaBytes,
    maskBytes: est.maskBytes,
    tensor512Bytes: est.tensor512Bytes,
    hasSourceFile: Boolean(sourceFile && sourceFile.size > 0),
  })

  // Skip early mask allocation and HTMLImage/RGBA warm-decodes.
  // Those retained a full-res empty mask + decoded bitmap + RGBA buffer on top
  // of BiRefNet WASM — a major Safari peak-memory contributor. segmentWithBirefNet
  // performs a single capped decode for preprocess/review.
  const imageBlob = await resolveSourceImageBlob(
    objectUrl,
    width,
    height,
    sourceFile,
  )

  const { segmentWithBirefNet, BIREFNET_METHOD } = await import(
    '../mask/birefNet'
  )
  const result = await segmentWithBirefNet(imageBlob, width, height, {
    onProgress,
  })
  setMask(imageId, result.mask)
  const diagnosticSummary = toSummary({
    ...result.diagnostics,
    findings: result.diagnostics.findings.filter(
      (f) => f.severity !== 'info' || f.forcesReview,
    ),
  })
  return {
    confidence: result.confidence,
    needsReview: result.needsReview,
    requestedMethod: 'birefnet',
    methodUsed: result.methodUsed || BIREFNET_METHOD,
    genuineModelInference: true,
    device: result.device,
    diagnosticSummary,
    reviewReason: result.needsReview
      ? result.reviewReasons.length > 0
        ? result.reviewReasons.join(' · ')
        : 'uncertain auto-mask — inspect edges and openings'
      : undefined,
  }
}
