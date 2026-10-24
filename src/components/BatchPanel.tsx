import type { ExportFormat } from '../lib/export/exportImage'
import './BatchPanel.css'

type BatchPanelProps = {
  imageCount: number
  maskedCount: number
  /** Images still flagged for operator QC after auto-mask. */
  reviewCount?: number
  /** Images whose last API auto-mask attempt failed. */
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

  return (
    <section className="panel batch-panel" data-testid="batch-panel">
      <div className="batch-panel__header">
        <div className="batch-panel__title">
          <h2 id="batch-heading">Batch</h2>
          <p className="batch-panel__hint">
            On-device RMBG (first run ~88&nbsp;MB). Check Review badges, then
            export.
          </p>
        </div>
        <div className="batch-panel__stats" aria-label="Batch status">
          <span className="batch-panel__stat">
            <strong>{imageCount}</strong> images
          </span>
          <span className="batch-panel__stat">
            <strong>{maskedCount}</strong> masked
          </span>
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
              disabled={busy}
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
