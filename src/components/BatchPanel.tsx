import type { ExportFormat } from '../lib/export/exportImage'
import './BatchPanel.css'

type BatchPanelProps = {
  imageCount: number
  maskedCount: number
  /** Images still waiting for a first successful auto-mask (excludes in-flight). */
  pendingCount?: number
  /** Images currently loading the model or running inference. */
  runningCount?: number
  /** Images still flagged for operator QC after auto-mask. */
  reviewCount?: number
  /** Images whose last auto-mask attempt failed. */
  failedCount?: number
  busy: boolean
  progress: string | null
  exportFormat: ExportFormat
  onExportFormatChange: (format: ExportFormat) => void
  onApplyBackgroundToAll: () => void
  onApplyAdjustmentsToAll: () => void
  onAutoMaskAll: () => void
  onRetryFailed: () => void
  onRetrySelected: () => void
  onExportZip: (scope: 'all' | 'masked') => void
  canApplyFromSelection: boolean
  canRetrySelected: boolean
}

export function BatchPanel({
  imageCount,
  maskedCount,
  pendingCount = 0,
  runningCount = 0,
  reviewCount = 0,
  failedCount = 0,
  busy,
  progress,
  exportFormat,
  onExportFormatChange,
  onApplyBackgroundToAll,
  onApplyAdjustmentsToAll,
  onAutoMaskAll,
  onRetryFailed,
  onRetrySelected,
  onExportZip,
  canApplyFromSelection,
  canRetrySelected,
}: BatchPanelProps) {
  if (imageCount === 0) {
    return null
  }

  const needsStart =
    !busy && pendingCount > 0 && maskedCount === 0 && failedCount === 0

  return (
    <section className="panel batch-panel" data-testid="batch-panel">
      <div className="batch-panel__header">
        <div className="batch-panel__title">
          <h2 id="batch-heading">Batch</h2>
          <p className="batch-panel__hint">
            On-device RMBG (first run ~88&nbsp;MB; inference can take minutes on
            iPhone). Keep the Safari tab open. JPEG/PNG/WebP only — HEIC must
            be exported as JPEG (Most Compatible) before upload.
          </p>
        </div>
        <div className="batch-panel__stats" aria-label="Batch status">
          <span className="batch-panel__stat">
            <strong>{imageCount}</strong> images
          </span>
          <span className="batch-panel__stat" data-testid="batch-masked-count">
            <strong>{maskedCount}</strong> masked
          </span>
          {runningCount > 0 ? (
            <span
              className="batch-panel__stat"
              data-testid="batch-running-count"
            >
              <strong>{runningCount}</strong> running
            </span>
          ) : null}
          {pendingCount > 0 ? (
            <span
              className="batch-panel__stat batch-panel__stat--pending"
              data-testid="batch-pending-count"
            >
              <strong>{pendingCount}</strong> pending
            </span>
          ) : null}
          {reviewCount > 0 ? (
            <span
              className="batch-panel__stat batch-panel__stat--review"
              data-testid="batch-review-count"
            >
              <strong>{reviewCount}</strong> need review
            </span>
          ) : null}
          {failedCount > 0 ? (
            <span
              className="batch-panel__stat batch-panel__stat--review"
              data-testid="batch-failed-count"
            >
              <strong>{failedCount}</strong> failed
            </span>
          ) : null}
        </div>
      </div>

      {needsStart ? (
        <div
          className="batch-panel__cta"
          data-testid="batch-start-cta"
          role="status"
        >
          <p>
            Images are uploaded but processing has <strong>not</strong> started
            yet ({pendingCount} pending · {maskedCount} masked).
          </p>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={onAutoMaskAll}
            data-testid="batch-start-auto-mask"
          >
            Start Auto-mask all
          </button>
        </div>
      ) : null}

      <div className="batch-panel__groups">
        <div className="batch-panel__group">
          <h3 className="batch-panel__group-title">Actions</h3>
          <div className="batch-panel__row">
            <button
              type="button"
              className="button"
              disabled={busy || !canApplyFromSelection}
              onClick={onApplyBackgroundToAll}
              data-testid="batch-apply-bg"
            >
              Apply background to all
            </button>
            <button
              type="button"
              className="button"
              disabled={busy || !canApplyFromSelection}
              onClick={onApplyAdjustmentsToAll}
              data-testid="batch-apply-adjust"
            >
              Apply adjustments to all
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={busy || (pendingCount === 0 && failedCount === 0)}
              onClick={onAutoMaskAll}
              data-testid="batch-auto-mask"
            >
              Auto-mask all
            </button>
            <button
              type="button"
              className="button"
              disabled={busy || failedCount === 0}
              onClick={onRetryFailed}
              data-testid="batch-retry-failed"
            >
              Retry failed
            </button>
            <button
              type="button"
              className="button"
              disabled={busy || !canRetrySelected}
              onClick={onRetrySelected}
              data-testid="batch-retry-selected"
            >
              Retry selected
            </button>
          </div>
        </div>

        <div className="batch-panel__group">
          <h3 className="batch-panel__group-title">Export</h3>
          <div className="batch-panel__export">
            <label className="batch-panel__format">
              ZIP format
              <select
                value={exportFormat}
                disabled={busy}
                onChange={(event) =>
                  onExportFormatChange(event.target.value as ExportFormat)
                }
                data-testid="batch-zip-format"
              >
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
              </select>
            </label>
            <button
              type="button"
              className="button"
              disabled={busy || imageCount === 0}
              onClick={() => onExportZip('all')}
              data-testid="batch-export-all"
            >
              Download ZIP (all)
            </button>
            <button
              type="button"
              className="button"
              disabled={busy || maskedCount === 0}
              onClick={() => onExportZip('masked')}
              data-testid="batch-export-masked"
            >
              Download ZIP (masked only)
            </button>
          </div>
        </div>
      </div>

      {progress || busy ? (
        <div
          className="batch-panel__live"
          aria-live="polite"
          aria-atomic="true"
          aria-busy={busy}
        >
          {progress ? (
            <p className="batch-panel__status" data-testid="batch-progress">
              {progress}
            </p>
          ) : null}
          {busy ? (
            <p className="batch-panel__status" data-testid="batch-busy">
              Working…
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
