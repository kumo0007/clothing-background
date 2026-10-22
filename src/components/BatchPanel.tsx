import type { ExportFormat } from '../lib/export/exportImage'
import './BatchPanel.css'

type BatchPanelProps = {
  imageCount: number
  maskedCount: number
  busy: boolean
  progress: string | null
  exportFormat: ExportFormat
  onExportFormatChange: (format: ExportFormat) => void
  onApplyBackgroundToAll: () => void
  onApplyAdjustmentsToAll: () => void
  onAutoMaskAll: () => void
  onExportZip: (scope: 'all' | 'masked') => void
  canApplyFromSelection: boolean
}

export function BatchPanel({
  imageCount,
  maskedCount,
  busy,
  progress,
  exportFormat,
  onExportFormatChange,
  onApplyBackgroundToAll,
  onApplyAdjustmentsToAll,
  onAutoMaskAll,
  onExportZip,
  canApplyFromSelection,
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
            Auto-mask flat studio shots, apply the same background and adjust
            settings to every image, then download a ZIP — all local, no tokens.
          </p>
        </div>
        <div className="batch-panel__stats" aria-label="Batch status">
          <span className="batch-panel__stat">
            <strong>{imageCount}</strong> images
          </span>
          <span className="batch-panel__stat">
            <strong>{maskedCount}</strong> masked
          </span>
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
    </section>
  )
}
