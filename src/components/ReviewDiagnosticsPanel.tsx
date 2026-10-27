import { useEffect, useRef, useState } from 'react'
import type { MaskDiagnosticSummary } from '../types/mask'
import type { MaskPixelBuffer } from '../types/mask'
import type {
  DiagnosticFinding,
  DiagnosticOverlayKind,
} from '../lib/mask/diagnostics'
import {
  buildDiagnosticOverlay,
  runMaskDiagnostics,
} from '../lib/mask/diagnostics'
import { getMask } from '../lib/mask/maskStore'
import { cloneMaskBuffer } from '../lib/mask/createMask'
import { resizeMaskNearest } from '../lib/mask/apiTransparentPngMask'
import { MaskHistory } from '../lib/mask/maskHistory'
import {
  previewBorderStudioPeel,
  applyBorderStudioPeel,
  type BorderPeelPreview,
} from '../lib/mask/sdkMaskReview'
import { imageDataFromObjectUrl } from '../lib/image/imageDataFromUrl'
import { loadHtmlImage } from '../lib/image/loadHtmlImage'
import './ReviewDiagnosticsPanel.css'

type ReviewDiagnosticsPanelProps = {
  imageId: string
  imageName: string
  objectUrl: string
  width: number
  height: number
  methodUsed?: string
  needsReview: boolean
  reviewReason?: string
  hasManualEdits: boolean
  maskRevision: number
  summary?: MaskDiagnosticSummary
  onMaskRepaired: (
    nextSummary: MaskDiagnosticSummary,
    needsReview: boolean,
    reviewReason?: string,
  ) => void
  /** Keep parent mount while peel undo history exists. */
  onPeelUndoAvailabilityChange?: (canUndo: boolean) => void
}

const OVERLAY_OPTIONS: { id: DiagnosticOverlayKind; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'keep', label: 'KEEP' },
  { id: 'bg', label: 'BG' },
  { id: 'soft', label: 'Soft α' },
  { id: 'border-band', label: 'Border band' },
  { id: 'suspected-leak', label: 'Suspected leak' },
  { id: 'fragments', label: 'Fragments' },
]

/**
 * Put RGBA pixels via ImageData created on the destination context.
 * Never pass a cross-realm / constructed ImageData into putImageData (Firefox).
 */
function putRgba(
  ctx: CanvasRenderingContext2D,
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): void {
  const expected = width * height * 4
  if (width < 1 || height < 1 || rgba.length !== expected) {
    throw new Error(
      `Invalid overlay RGBA (${width}×${height}, len=${rgba.length}; need ${expected})`,
    )
  }
  let imageData: ImageData
  try {
    imageData = ctx.createImageData(width, height)
  } catch {
    imageData = new ImageData(width, height)
  }
  imageData.data.set(rgba)
  ctx.putImageData(imageData, 0, 0)
}

/** Cap overlay working resolution for large uploads (display still CSS-scaled). */
const OVERLAY_MAX_EDGE = 640
/** Cap decode used for diagnostics / peel preview — full-res iPhone photos OOM Safari. */
const DIAG_SOURCE_MAX_EDGE = 1280

function scaleFindingsIndices(
  findings: DiagnosticFinding[],
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): DiagnosticFinding[] {
  if (srcW === dstW && srcH === dstH) return findings
  const sx = dstW / srcW
  const sy = dstH / srcH
  return findings.map((f) => {
    if (!f.sampleIndices?.length) return f
    const mapped = new Set<number>()
    for (const i of f.sampleIndices) {
      const x = i % srcW
      const y = Math.floor(i / srcW)
      const nx = Math.min(dstW - 1, Math.max(0, Math.round(x * sx)))
      const ny = Math.min(dstH - 1, Math.max(0, Math.round(y * sy)))
      mapped.add(ny * dstW + nx)
    }
    return { ...f, sampleIndices: [...mapped] }
  })
}

function toSummary(
  diagnostics: ReturnType<typeof runMaskDiagnostics>,
): MaskDiagnosticSummary {
  return {
    reviewProfile: diagnostics.reviewProfile,
    heuristicScore: diagnostics.heuristicScore,
    score: diagnostics.heuristicScore,
    ruleIds: diagnostics.findings.map((f) => f.ruleId),
    findings: diagnostics.findings
      .filter((f) => f.severity !== 'info' || f.forcesReview)
      .map((f) => ({
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

function scaleToFit(
  width: number,
  height: number,
  maxEdge: number,
): { dw: number; dh: number; scale: number } {
  const long = Math.max(width, height)
  if (long <= maxEdge) {
    return { dw: width, dh: height, scale: 1 }
  }
  const scale = maxEdge / long
  return {
    dw: Math.max(1, Math.round(width * scale)),
    dh: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

export function ReviewDiagnosticsPanel({
  imageId,
  imageName,
  objectUrl,
  width,
  height,
  methodUsed,
  needsReview,
  reviewReason,
  hasManualEdits,
  maskRevision,
  summary,
  onMaskRepaired,
  onPeelUndoAvailabilityChange,
}: ReviewDiagnosticsPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peelHistoryRef = useRef(new MaskHistory())
  const sourceImageRef = useRef<ImageData | null>(null)
  const sourceKeyRef = useRef('')
  const sourceScaleRef = useRef({ dw: 0, dh: 0 })
  /** Findings (incl. sampleIndices) in sourceScaleRef coordinates. */
  const findingsForOverlayRef = useRef<DiagnosticFinding[]>([])
  const overlayScratchRef = useRef<HTMLCanvasElement | null>(null)
  /** Revision the current peel preview was computed against. */
  const peelPreviewRevisionRef = useRef<number | null>(null)
  const peelPreviewImageRef = useRef<string | null>(null)
  /** Skip clearing peel history when this panel caused the revision bump. */
  const ignoreNextRevisionClearRef = useRef(false)

  const [overlay, setOverlay] = useState<DiagnosticOverlayKind>(
    needsReview ? 'fragments' : 'none',
  )
  const [peelPreview, setPeelPreview] = useState<BorderPeelPreview | null>(null)
  const [peelBusy, setPeelBusy] = useState(false)
  const [peelError, setPeelError] = useState<string | null>(null)
  const [canUndoPeel, setCanUndoPeel] = useState(false)
  const [liveSummary, setLiveSummary] = useState<MaskDiagnosticSummary | undefined>(
    summary,
  )
  const [overlayBusy, setOverlayBusy] = useState(false)
  const [overlayError, setOverlayError] = useState<string | null>(null)

  const findings = liveSummary?.findings ?? summary?.findings ?? []
  const profile = liveSummary?.reviewProfile ?? summary?.reviewProfile ?? 'neural'
  const heuristicScore =
    liveSummary?.heuristicScore ??
    liveSummary?.score ??
    summary?.heuristicScore ??
    summary?.score

  /** Downscaled RGB for diagnostics/peel — never decode full iPhone megapixels here. */
  const ensureSourceImage = async (): Promise<{
    data: ImageData
    dw: number
    dh: number
  }> => {
    const { dw, dh } = scaleToFit(width, height, DIAG_SOURCE_MAX_EDGE)
    const key = `${objectUrl}|${dw}x${dh}`
    if (
      sourceImageRef.current &&
      sourceKeyRef.current === key &&
      sourceScaleRef.current.dw === dw &&
      sourceScaleRef.current.dh === dh
    ) {
      return { data: sourceImageRef.current, dw, dh }
    }
    const data = await imageDataFromObjectUrl(objectUrl, dw, dh)
    sourceImageRef.current = data
    sourceKeyRef.current = key
    sourceScaleRef.current = { dw, dh }
    return { data, dw, dh }
  }

  const getOverlayScratch = (dw: number, dh: number) => {
    if (!overlayScratchRef.current) {
      overlayScratchRef.current = document.createElement('canvas')
    }
    const c = overlayScratchRef.current
    if (c.width !== dw) c.width = dw
    if (c.height !== dh) c.height = dh
    return c
  }

  const setUndoAvailable = (next: boolean) => {
    setCanUndoPeel(next)
    onPeelUndoAvailabilityChange?.(next)
  }

  // Reset peel/cache only when switching images — never when summary updates.
  useEffect(() => {
    sourceImageRef.current = null
    sourceKeyRef.current = ''
    sourceScaleRef.current = { dw: 0, dh: 0 }
    findingsForOverlayRef.current = []
    peelPreviewRevisionRef.current = null
    peelPreviewImageRef.current = null
    ignoreNextRevisionClearRef.current = false
    setLiveSummary(summary)
    setPeelPreview(null)
    setPeelError(null)
    setOverlayError(null)
    peelHistoryRef.current.clear()
    setUndoAvailable(false)
    setOverlay(needsReview ? 'fragments' : 'none')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- image switch only
  }, [imageId])

  // External mask edits invalidate peel preview/history (except our own apply/undo).
  useEffect(() => {
    if (ignoreNextRevisionClearRef.current) {
      ignoreNextRevisionClearRef.current = false
      return
    }
    setPeelPreview(null)
    peelPreviewRevisionRef.current = null
    peelPreviewImageRef.current = null
    peelHistoryRef.current.clear()
    setUndoAvailable(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision identity only
  }, [maskRevision])

  // Re-diagnose when the saved mask revision changes.
  useEffect(() => {
    let cancelled = false
    const expectedImageId = imageId
    ;(async () => {
      try {
        const { data: imageData, dw, dh } = await ensureSourceImage()
        if (cancelled) return
        const still = getMask(expectedImageId)
        if (!still) return
        const diagMask =
          still.width === dw && still.height === dh
            ? still
            : resizeMaskNearest(still, dw, dh)
        const diagnostics = runMaskDiagnostics({
          mask: diagMask,
          imageData,
          profile: 'neural',
          method: methodUsed ?? 'birefnet-lite-512',
          hasManualEdits,
          maskRevision,
        })
        if (cancelled) return
        findingsForOverlayRef.current = diagnostics.findings
        setLiveSummary(toSummary(diagnostics))
      } catch {
        // Keep last summary if decode fails.
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ensureSourceImage uses current props
  }, [imageId, objectUrl, width, height, methodUsed, hasManualEdits, maskRevision])

  // Paint diagnostic canvas at display resolution only — never full-res scratch
  // canvases (iPhone Safari OOMs → black #111 box).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let cancelled = false
    setOverlayBusy(true)
    setOverlayError(null)
    ;(async () => {
      try {
        const mask = getMask(imageId)
        if (!mask) return

        const { dw, dh } = scaleToFit(width, height, OVERLAY_MAX_EDGE)
        canvas.width = dw
        canvas.height = dh
        ctx.imageSmoothingEnabled = true

        const htmlImage = await loadHtmlImage(objectUrl)
        if (cancelled) return
        ctx.clearRect(0, 0, dw, dh)
        ctx.drawImage(htmlImage, 0, 0, dw, dh)

        if (overlay === 'none') {
          return
        }

        const scaledMask =
          mask.width === dw && mask.height === dh
            ? mask
            : resizeMaskNearest(mask, dw, dh)
        const srcDw = sourceScaleRef.current.dw || mask.width
        const srcDh = sourceScaleRef.current.dh || mask.height
        const scaledFindings = scaleFindingsIndices(
          findingsForOverlayRef.current,
          srcDw,
          srcDh,
          dw,
          dh,
        )
        const overlayData = buildDiagnosticOverlay(
          scaledMask,
          overlay,
          scaledFindings,
        )
        if (
          overlayData.width !== dw ||
          overlayData.height !== dh ||
          overlayData.data.length !== dw * dh * 4
        ) {
          throw new Error(
            `Diagnostic overlay buffer size mismatch (${overlayData.width}×${overlayData.height}, len=${overlayData.data.length}; need ${dw}×${dh})`,
          )
        }
        const scratch = getOverlayScratch(dw, dh)
        const octx = scratch.getContext('2d')
        if (!octx) throw new Error('Could not create overlay canvas')
        octx.clearRect(0, 0, dw, dh)
        // Always allocate ImageData from THIS canvas context. `new ImageData(...)`
        // from a shared helper is rejected by Firefox putImageData
        // ("Argument 1 does not implement interface ImageData") even when
        // instanceof ImageData is true in some realms.
        putRgba(octx, overlayData.data, dw, dh)
        ctx.globalAlpha = 0.85
        ctx.drawImage(scratch, 0, 0)
        ctx.globalAlpha = 1

        // Visualize pending peel candidate as red REMOVE diff (non-destructive).
        if (
          peelPreview &&
          peelPreviewImageRef.current === imageId &&
          peelPreviewRevisionRef.current === maskRevision
        ) {
          const cand =
            peelPreview.candidate.width === dw &&
            peelPreview.candidate.height === dh
              ? peelPreview.candidate
              : resizeMaskNearest(peelPreview.candidate, dw, dh)
          const diffRgba = new Uint8ClampedArray(dw * dh * 4)
          for (let i = 0; i < dw * dh; i += 1) {
            const was = scaledMask.data[i]! >= 128
            const stays = cand.data[i]! >= 128
            if (was && !stays) {
              const o = i * 4
              diffRgba[o] = 220
              diffRgba[o + 1] = 40
              diffRgba[o + 2] = 40
              diffRgba[o + 3] = 160
            }
          }
          octx.clearRect(0, 0, dw, dh)
          putRgba(octx, diffRgba, dw, dh)
          ctx.drawImage(scratch, 0, 0)
        }
      } catch (err) {
        if (!cancelled) {
          setOverlayError(
            err instanceof Error
              ? err.message
              : 'Could not render diagnostic preview',
          )
        }
      } finally {
        if (!cancelled) setOverlayBusy(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paint on overlay/revision only
  }, [
    imageId,
    objectUrl,
    width,
    height,
    overlay,
    maskRevision,
    liveSummary,
    peelPreview,
  ])

  const refreshAfterMaskChange = async () => {
    const current = getMask(imageId)
    if (!current) return
    const { data: imageData, dw, dh } = await ensureSourceImage()
    const diagMask =
      current.width === dw && current.height === dh
        ? current
        : resizeMaskNearest(current, dw, dh)
    const diagnostics = runMaskDiagnostics({
      mask: diagMask,
      imageData,
      profile: 'neural',
      method: methodUsed ?? 'birefnet-lite-512',
      hasManualEdits: true,
      maskRevision: maskRevision + 1,
      resized: false,
    })
    findingsForOverlayRef.current = diagnostics.findings
    const next = toSummary(diagnostics)
    setLiveSummary(next)
    ignoreNextRevisionClearRef.current = true
    onMaskRepaired(
      next,
      diagnostics.needsReview,
      diagnostics.needsReview
        ? diagnostics.reviewReasons.join(' · ')
        : undefined,
    )
  }

  const handlePreviewPeel = async () => {
    setPeelBusy(true)
    setPeelError(null)
    const expectedImageId = imageId
    const expectedRevision = maskRevision
    try {
      const current = getMask(expectedImageId)
      if (!current) throw new Error('No mask loaded')
      const { data: imageData, dw, dh } = await ensureSourceImage()
      if (imageId !== expectedImageId || maskRevision !== expectedRevision) {
        return
      }
      const peelMask =
        current.width === dw && current.height === dh
          ? current
          : resizeMaskNearest(current, dw, dh)
      const preview = previewBorderStudioPeel(peelMask, imageData)
      peelPreviewRevisionRef.current = expectedRevision
      peelPreviewImageRef.current = expectedImageId
      setPeelPreview(preview)
    } catch (err) {
      setPeelError(err instanceof Error ? err.message : 'Peel preview failed')
    } finally {
      setPeelBusy(false)
    }
  }

  const handleApplyPeel = async () => {
    if (!peelPreview?.recommendApply) return
    if (
      peelPreviewImageRef.current !== imageId ||
      peelPreviewRevisionRef.current !== maskRevision
    ) {
      setPeelError('Peel preview is stale — generate a new preview')
      setPeelPreview(null)
      return
    }
    setPeelBusy(true)
    setPeelError(null)
    try {
      const current = getMask(imageId)
      if (!current) throw new Error('No mask loaded')
      const candidate =
        peelPreview.candidate.width === current.width &&
        peelPreview.candidate.height === current.height
          ? peelPreview.candidate
          : // Upsample only the peeled candidate — soft alpha elsewhere preserved
            // by applying REMOVE-only delta rather than replacing all bytes.
            null
      peelHistoryRef.current.push(cloneMaskBuffer(current))
      if (candidate) {
        applyBorderStudioPeel(current, candidate)
      } else {
        const up = resizeMaskNearest(
          peelPreview.candidate,
          current.width,
          current.height,
        )
        // Preview was computed on a downscaled mask; only clear pixels that
        // the peel removed so untouched soft alpha is not nearest-quantized.
        const down = resizeMaskNearest(current, up.width, up.height)
        for (let i = 0; i < down.data.length; i += 1) {
          if (down.data[i]! >= 128 && peelPreview.candidate.data[i]! < 128) {
            down.data[i] = 0
          }
        }
        const merged = resizeMaskNearest(down, current.width, current.height)
        for (let i = 0; i < current.data.length; i += 1) {
          if (merged.data[i]! < 128 && current.data[i]! >= 128) {
            current.data[i] = 0
          }
        }
      }
      setUndoAvailable(peelHistoryRef.current.canUndo)
      setPeelPreview(null)
      peelPreviewRevisionRef.current = null
      peelPreviewImageRef.current = null
      await refreshAfterMaskChange()
    } catch (err) {
      setPeelError(err instanceof Error ? err.message : 'Peel apply failed')
    } finally {
      setPeelBusy(false)
    }
  }

  const handleUndoPeel = async () => {
    setPeelBusy(true)
    setPeelError(null)
    try {
      const current = getMask(imageId)
      if (!current) throw new Error('No mask loaded')
      const previous = peelHistoryRef.current.undo(current)
      if (!previous) throw new Error('Nothing to undo')
      current.data.set(previous.data)
      setUndoAvailable(peelHistoryRef.current.canUndo)
      setPeelPreview(null)
      peelPreviewRevisionRef.current = null
      peelPreviewImageRef.current = null
      await refreshAfterMaskChange()
    } catch (err) {
      setPeelError(err instanceof Error ? err.message : 'Undo peel failed')
    } finally {
      setPeelBusy(false)
    }
  }

  const mask: MaskPixelBuffer | undefined = getMask(imageId)

  if (!needsReview && findings.length === 0 && !canUndoPeel && !peelPreview) {
    return null
  }

  return (
    <section
      className="review-diagnostics"
      data-testid="review-diagnostics"
      aria-labelledby="review-diagnostics-heading"
    >
      <div className="review-diagnostics__header">
        <h3 id="review-diagnostics-heading">Mask review diagnostics</h3>
        <p className="review-diagnostics__meta">
          <strong>{imageName}</strong>
          {methodUsed ? ` · ${methodUsed}` : ''}
          {` · ${profile}`}
          {typeof heuristicScore === 'number'
            ? ` · score ${heuristicScore.toFixed(2)}`
            : ''}
          {hasManualEdits ? ' · edited' : ''}
          {needsReview ? ' · needs review' : ''}
        </p>
        <p className="review-diagnostics__score-note">
          Score is a heuristic risk signal, not calibrated model confidence.
        </p>
        {reviewReason ? (
          <p
            className="review-diagnostics__reason"
            data-testid="review-diagnostics-reason"
          >
            {reviewReason}
          </p>
        ) : null}
      </div>

      {findings.length > 0 ? (
        <details className="review-diagnostics__details" open={needsReview}>
          <summary>
            {findings.length} finding{findings.length === 1 ? '' : 's'}
          </summary>
          <ul className="review-diagnostics__list" data-testid="review-findings">
            {findings.map((f) => (
              <li
                key={`${f.ruleId}-${f.message}`}
                className={`review-diagnostics__finding review-diagnostics__finding--${f.severity}`}
                data-rule-id={f.ruleId}
              >
                <div className="review-diagnostics__finding-title">
                  <code>{f.ruleId}</code>
                  <span className="review-diagnostics__severity">{f.severity}</span>
                </div>
                <p>{f.message}</p>
                <p className="review-diagnostics__evidence">
                  measured {f.measuredValue.toFixed(3)} · threshold{' '}
                  {f.threshold.toFixed(3)}
                  {f.unit ? ` · ${f.unit}` : ''} · region {f.affectedRegion}
                </p>
                <p className="review-diagnostics__action">{f.suggestedAction}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="review-diagnostics__overlay-controls">
        <span>Overlay (read-only — does not edit the mask)</span>
        <div
          className="review-diagnostics__overlay-buttons"
          role="group"
          aria-label="Diagnostic overlay"
        >
          {OVERLAY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={
                overlay === opt.id
                  ? 'review-diagnostics__chip review-diagnostics__chip--active'
                  : 'review-diagnostics__chip'
              }
              onClick={() => setOverlay(opt.id)}
              aria-pressed={overlay === opt.id}
              data-testid={`review-overlay-${opt.id}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {overlay === 'fragments' ? (
          <p className="review-diagnostics__legend">
            Green = main KEEP · Red = detached significant · Yellow = noise dust
          </p>
        ) : null}
        {overlayBusy ? (
          <p className="review-diagnostics__overlay-status" aria-live="polite">
            Updating overlay…
          </p>
        ) : null}
        {overlayError ? (
          <p
            className="review-diagnostics__overlay-error"
            role="alert"
            data-testid="review-overlay-error"
          >
            {overlayError}
          </p>
        ) : null}
      </div>

      <canvas
        ref={canvasRef}
        className="review-diagnostics__canvas"
        data-testid="review-diagnostics-canvas"
      />

      <div className="review-diagnostics__repair">
        <p className="review-diagnostics__repair-hint">
          Border peel: preview first, then apply. Undo peel restores the prior
          mask. Diagnostics never change pixels by themselves.
        </p>
        <div className="review-diagnostics__repair-actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={peelBusy || !mask}
            onClick={() => void handlePreviewPeel()}
            data-testid="review-peel-preview"
          >
            Preview border peel
          </button>
          <button
            type="button"
            className="button"
            disabled={
              peelBusy ||
              !peelPreview?.recommendApply ||
              peelPreviewImageRef.current !== imageId ||
              peelPreviewRevisionRef.current !== maskRevision
            }
            onClick={() => void handleApplyPeel()}
            data-testid="review-peel-apply"
          >
            Apply peel
          </button>
          <button
            type="button"
            className="button button--ghost"
            disabled={peelBusy || !canUndoPeel}
            onClick={() => void handleUndoPeel()}
            data-testid="review-peel-undo"
          >
            Undo peel
          </button>
        </div>
        {peelPreview ? (
          <p
            className="review-diagnostics__peel-status"
            data-testid="review-peel-status"
            aria-live="polite"
          >
            {peelPreview.reason}
            {peelPreview.recommendApply
              ? ` · KEEP ${peelPreview.keepBefore} → ${peelPreview.keepAfter}`
              : ''}
          </p>
        ) : null}
        {peelError ? (
          <p className="review-diagnostics__peel-error" role="alert">
            {peelError}
          </p>
        ) : null}
      </div>
    </section>
  )
}
