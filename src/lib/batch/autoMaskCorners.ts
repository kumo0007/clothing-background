import { loadHtmlImage } from '../image/loadHtmlImage'
import { imageDataFromObjectUrl } from '../image/imageDataFromUrl'
import { getOrCreateMask, setMask } from '../mask/maskStore'
import type { BgRemoveSdkProgress } from '../mask/bgRemoveSdk'
import type { MaskDiagnosticSummary } from '../../types/mask'

export type AutoMaskProgress = BgRemoveSdkProgress

/**
 * Auto-mask one image with browser-local `bg-remove-sdk` (RMBG-1.4) and commit
 * the KEEP alpha mask to `maskStore`. Original upload RGB is left untouched.
 *
 * No Poof / remove.bg / hosted inference API. Model weights download once
 * (~88 MB fp16) and are cached; inference runs in a Web Worker.
 */
export type AutoMaskCornersResult = {
  confidence: number
  needsReview: boolean
  requestedMethod: 'sdk'
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

export async function autoMaskCornersForImage(
  imageId: string,
  objectUrl: string,
  width: number,
  height: number,
  _tolerance = 40,
  onProgress?: (event: AutoMaskProgress) => void,
): Promise<AutoMaskCornersResult> {
  getOrCreateMask(imageId, width, height)

  // Validate the object URL is still readable.
  await loadHtmlImage(objectUrl)

  const blobResponse = await fetch(objectUrl)
  if (!blobResponse.ok) {
    throw new Error('Could not read the uploaded image for local SDK auto-mask.')
  }
  const imageBlob = await blobResponse.blob()

  // Original RGB for confidence heuristics only — never overwritten.
  let sourceImageData: ImageData | undefined
  try {
    sourceImageData = await imageDataFromObjectUrl(objectUrl, width, height)
  } catch {
    sourceImageData = undefined
  }

  // Lazy-load the SDK adapter so transformers.js stays out of the initial bundle.
  const { segmentWithBgRemoveSdk, BG_REMOVE_SDK_METHOD } = await import(
    '../mask/bgRemoveSdk'
  )

  const result = await segmentWithBgRemoveSdk(imageBlob, width, height, {
    onProgress,
    sourceImageData,
  })

  setMask(imageId, result.mask)

  // Persist defect/uncertain findings for the diagnostics panel; drop pure info.
  const diagnosticSummary = toSummary({
    ...result.diagnostics,
    findings: result.diagnostics.findings.filter(
      (f) => f.severity !== 'info' || f.forcesReview,
    ),
  })

  return {
    confidence: result.confidence,
    needsReview: result.needsReview,
    requestedMethod: 'sdk',
    methodUsed: result.methodUsed || BG_REMOVE_SDK_METHOD,
    genuineModelInference: true,
    device: result.device,
    diagnosticSummary,
    reviewReason:
      result.needsReview
        ? result.reviewReasons.length > 0
          ? result.reviewReasons.join(' · ')
          : 'uncertain auto-mask — inspect edges and openings'
        : undefined,
  }
}
