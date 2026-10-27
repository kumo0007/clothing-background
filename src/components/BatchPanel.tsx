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
  /** Kept for callers; progress text is no longer shown in the Batch UI. */
  progress?: string | null
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
  progress: _progress = null,
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
  const canAutoMask = !busy && (pendingCount > 0 || failedCount > 0)

  return (
    <section className="panel batch-panel" data-testid="batch-panel">
      <div className="batch-panel__header">
        <div className="batch-panel__title">
          <h2 id="batch-heading">Batch</h2>
        </div>
        <div className="batch-panel__stats" aria-label="Batch status">
          <span className="batch-panel__stat">
            <strong>{imageCount}</strong>
            <span className="batch-panel__stat-label">images</span>
          </span>
          <span className="batch-panel__stat" data-testid="batch-masked-count">
            <strong>{maskedCount}</strong>
            <span className="batch-panel__stat-label">masked</span>
          </span>
          {runningCount > 0 ? (
            <span
              className="batch-panel__stat batch-panel__stat--running"
              data-testid="batch-running-count"
            >
              <strong>{runningCount}</strong>
              <span className="batch-panel__stat-label">running</span>
            </span>
          ) : null}
          {pendingCount > 0 ? (
            <span
              className="batch-panel__stat batch-panel__stat--pending"
              data-testid="batch-pending-count"
            >
              <strong>{pendingCount}</strong>
              <span className="batch-panel__stat-label">pending</span>
            </span>
          ) : null}
          {reviewCount > 0 ? (
            <span
              className="batch-panel__stat batch-panel__stat--review"
              data-testid="batch-review-count"
            >
              <strong>{reviewCount}</strong>
              <span className="batch-panel__stat-label">review</span>
            </span>
          ) : null}
          {failedCount > 0 ? (
            <span
              className="batch-panel__stat batch-panel__stat--failed"
              data-testid="batch-failed-count"
            >
              <strong>{failedCount}</strong>
              <span className="batch-panel__stat-label">failed</span>
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
          <div className="batch-panel__cta-copy">
            <p className="batch-panel__cta-title">Ready to mask</p>
            <p>
              {pendingCount} photo{pendingCount === 1 ? '' : 's'} uploaded —
              processing has not started yet.
            </p>
          </div>
          <button
            type="button"
            className="button button--primary batch-panel__cta-button"
            disabled={busy}
            onClick={onAutoMaskAll}
            data-testid="batch-auto-mask"
          >
            Start Auto-mask all
          </button>
        </div>
      ) : null}

      <div className="batch-panel__groups" aria-busy={busy}>
        <div className="batch-panel__group">
          <h3 className="batch-panel__group-title">Masking</h3>
          <div className="batch-panel__row">
            {!needsStart ? (
              <button
                type="button"
                className="button button--primary"
                disabled={!canAutoMask}
                onClick={onAutoMaskAll}
                data-testid="batch-auto-mask"
              >
                Auto-mask all
              </button>
            ) : (
              <p className="batch-panel__group-hint">
                Use the green Start button above to begin masking.
              </p>
            )}
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
          <h3 className="batch-panel__group-title">Apply to all</h3>
          <div className="batch-panel__row">
            <button
              type="button"
              className="button"
              disabled={busy || !canApplyFromSelection}
              onClick={onApplyBackgroundToAll}
              data-testid="batch-apply-bg"
            >
              Apply background
            </button>
            <button
              type="button"
              className="button"
              disabled={busy || !canApplyFromSelection}
              onClick={onApplyAdjustmentsToAll}
              data-testid="batch-apply-adjust"
            >
              Apply adjustments
            </button>
          </div>
        </div>

        <div className="batch-panel__group batch-panel__group--export">
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
              Download ZIP (masked)
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
