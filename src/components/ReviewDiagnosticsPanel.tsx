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
import { MaskHistory } from '../lib/mask/maskHistory'
import {
  previewBorderStudioPeel,
  applyBorderStudioPeel,
  type BorderPeelPreview,
} from '../lib/mask/sdkMaskReview'
import { imageDataFromObjectUrl } from '../lib/image/imageDataFromUrl'
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

/** Cap overlay working resolution for large uploads (display still CSS-scaled). */
const OVERLAY_MAX_EDGE = 640

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
}: ReviewDiagnosticsPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peelHistoryRef = useRef(new MaskHistory())
  const sourceImageRef = useRef<ImageData | null>(null)
  const sourceKeyRef = useRef('')
  /** Full findings (incl. sampleIndices) for overlays — not the compact summary. */
  const findingsForOverlayRef = useRef<DiagnosticFinding[]>([])
  const scratchRef = useRef<{
    src: HTMLCanvasElement
    ov: HTMLCanvasElement
  } | null>(null)

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

  const findings = liveSummary?.findings ?? summary?.findings ?? []
  const profile = liveSummary?.reviewProfile ?? summary?.reviewProfile ?? 'neural'
  const heuristicScore =
    liveSummary?.heuristicScore ??
    liveSummary?.score ??
    summary?.heuristicScore ??
    summary?.score

  const ensureSourceImage = async (): Promise<ImageData> => {
    const key = `${objectUrl}|${width}x${height}`
    if (sourceImageRef.current && sourceKeyRef.current === key) {
      return sourceImageRef.current
    }
    const data = await imageDataFromObjectUrl(objectUrl, width, height)
    sourceImageRef.current = data
    sourceKeyRef.current = key
    return data
  }

  const getScratch = () => {
    if (!scratchRef.current) {
      scratchRef.current = {
        src: document.createElement('canvas'),
        ov: document.createElement('canvas'),
      }
    }
    return scratchRef.current
  }

  // Reset peel/cache only when switching images — never when summary updates.
  useEffect(() => {
    sourceImageRef.current = null
    sourceKeyRef.current = ''
    findingsForOverlayRef.current = []
    setLiveSummary(summary)
    setPeelPreview(null)
    setPeelError(null)
    peelHistoryRef.current.clear()
    setCanUndoPeel(false)
    setOverlay(needsReview ? 'fragments' : 'none')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- image switch only
  }, [imageId])

  // Re-diagnose when the saved mask revision changes.
  useEffect(() => {
    let cancelled = false
    const expectedImageId = imageId
    ;(async () => {
      try {
        const imageData = await ensureSourceImage()
        if (cancelled) return
        const still = getMask(expectedImageId)
        if (!still) return
        const diagnostics = runMaskDiagnostics({
          mask: still,
          imageData,
          profile: 'neural',
          method: methodUsed ?? 'bg-remove-sdk-rmbg1.4',
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

  // Paint diagnostic canvas — cached source decode; downscaled for large images.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let cancelled = false
    setOverlayBusy(true)
    ;(async () => {
      try {
        const img = await ensureSourceImage()
        if (cancelled) return
        const mask = getMask(imageId)
        if (!mask) return

        const { dw, dh } = scaleToFit(width, height, OVERLAY_MAX_EDGE)
        canvas.width = dw
        canvas.height = dh
        ctx.imageSmoothingEnabled = true

        const scratch = getScratch()
        scratch.src.width = width
        scratch.src.height = height
        const sctx = scratch.src.getContext('2d')
        if (!sctx) return
        sctx.putImageData(img, 0, 0)
        ctx.clearRect(0, 0, dw, dh)
        ctx.drawImage(scratch.src, 0, 0, dw, dh)

        if (overlay === 'none') {
          return
        }

        const overlayData = buildDiagnosticOverlay(
          mask,
          overlay,
          findingsForOverlayRef.current,
        )
        scratch.ov.width = width
        scratch.ov.height = height
        const octx = scratch.ov.getContext('2d')
        if (!octx) return
        octx.putImageData(overlayData, 0, 0)
        ctx.drawImage(scratch.ov, 0, 0, dw, dh)
      } catch {
        // Overlay is best-effort.
      } finally {
        if (!cancelled) setOverlayBusy(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paint on overlay/revision only
  }, [imageId, objectUrl, width, height, overlay, maskRevision])

  const refreshAfterMaskChange = async () => {
    const current = getMask(imageId)
    if (!current) return
    const imageData = await ensureSourceImage()
    const diagnostics = runMaskDiagnostics({
      mask: current,
      imageData,
      profile: 'neural',
      method: methodUsed ?? 'bg-remove-sdk-rmbg1.4',
      hasManualEdits: true,
      maskRevision: maskRevision + 1,
    })
    findingsForOverlayRef.current = diagnostics.findings
    const next = toSummary(diagnostics)
    setLiveSummary(next)
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
    try {
      const current = getMask(imageId)
      if (!current) throw new Error('No mask loaded')
      const imageData = await ensureSourceImage()
      const preview = previewBorderStudioPeel(current, imageData)
      setPeelPreview(preview)
    } catch (err) {
      setPeelError(err instanceof Error ? err.message : 'Peel preview failed')
    } finally {
      setPeelBusy(false)
    }
  }

  const handleApplyPeel = async () => {
    if (!peelPreview?.recommendApply) return
    setPeelBusy(true)
    setPeelError(null)
    try {
      const current = getMask(imageId)
      if (!current) throw new Error('No mask loaded')
      peelHistoryRef.current.push(cloneMaskBuffer(current))
      applyBorderStudioPeel(current, peelPreview.candidate)
      setCanUndoPeel(peelHistoryRef.current.canUndo)
      setPeelPreview(null)
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
      setCanUndoPeel(peelHistoryRef.current.canUndo)
      await refreshAfterMaskChange()
    } catch (err) {
      setPeelError(err instanceof Error ? err.message : 'Undo peel failed')
    } finally {
      setPeelBusy(false)
    }
  }

  const mask: MaskPixelBuffer | undefined = getMask(imageId)

  if (!needsReview && findings.length === 0) {
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
            disabled={peelBusy || !peelPreview?.recommendApply}
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
