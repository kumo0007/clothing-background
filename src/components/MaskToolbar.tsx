import type { BrushMode, EditorTool, EditorViewMode } from '../types/mask'

type MaskToolbarProps = {
  tool: EditorTool
  brushMode: BrushMode
  brushSize: number
  viewMode: EditorViewMode
  showOverlay: boolean
  scalePercent: number
  canUndo: boolean
  canRedo: boolean
  polygonPointCount: number
  similarTolerance: number
  similarConnected: boolean
  onToolChange: (tool: EditorTool) => void
  onBrushModeChange: (mode: BrushMode) => void
  onBrushSizeChange: (size: number) => void
  onViewModeChange: (mode: EditorViewMode) => void
  onToggleOverlay: () => void
  onUndo: () => void
  onRedo: () => void
  onClearMask: () => void
  onInvertMask: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onFit: () => void
  onApplyPolygon: (mode: BrushMode) => void
  onCancelPolygon: () => void
  onSimilarToleranceChange: (value: number) => void
  onSimilarConnectedChange: (value: boolean) => void
  onRemoveCornerBackground: () => void
  featherRadius: number
  onFeatherRadiusChange: (value: number) => void
  onMorphOpen: () => void
  onMorphClose: () => void
  onFillHoles: () => void
  onFeatherEdges: () => void
}

const BRUSH_PRESETS = [10, 20, 50, 100]

export function MaskToolbar({
  tool,
  brushMode,
  brushSize,
  viewMode,
  showOverlay,
  scalePercent,
  canUndo,
  canRedo,
  polygonPointCount,
  onToolChange,
  onBrushModeChange,
  onBrushSizeChange,
  onViewModeChange,
  onToggleOverlay,
  onUndo,
  onRedo,
  onClearMask,
  onInvertMask,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFit,
  onApplyPolygon,
  onCancelPolygon,
  similarTolerance,
  similarConnected,
  onSimilarToleranceChange,
  onSimilarConnectedChange,
  onRemoveCornerBackground,
  featherRadius,
  onFeatherRadiusChange,
  onMorphOpen,
  onMorphClose,
  onFillHoles,
  onFeatherEdges,
}: MaskToolbarProps) {
  return (
    <aside className="mask-toolbar" data-testid="mask-toolbar">
      <section className="mask-toolbar__section">
        <h3>View</h3>
        <div className="mask-toolbar__row">
          {(
            [
              ['edit', 'Edit'],
              ['original', 'Original'],
              ['mask', 'Mask'],
              ['result', 'Result'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`button${viewMode === mode ? ' button--active' : ''}`}
              aria-pressed={viewMode === mode}
              onClick={() => onViewModeChange(mode)}
              data-testid={`view-${mode}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mask-toolbar__check">
          <input
            type="checkbox"
            checked={showOverlay}
            onChange={onToggleOverlay}
            disabled={viewMode !== 'edit'}
          />
          Colored overlay (edit aid)
        </label>
      </section>

      <section className="mask-toolbar__section">
        <h3>Tools</h3>
        <div className="mask-toolbar__row">
          <button
            type="button"
            className={`button${tool === 'brush' ? ' button--active' : ''}`}
            aria-pressed={tool === 'brush'}
            onClick={() => onToolChange('brush')}
            data-testid="tool-brush"
          >
            Brush
          </button>
          <button
            type="button"
            className={`button${tool === 'polygon' ? ' button--active' : ''}`}
            aria-pressed={tool === 'polygon'}
            onClick={() => onToolChange('polygon')}
            data-testid="tool-polygon"
          >
            Polygon
          </button>
          <button
            type="button"
            className={`button${tool === 'similar' ? ' button--active' : ''}`}
            aria-pressed={tool === 'similar'}
            onClick={() => onToolChange('similar')}
            data-testid="tool-similar"
          >
            Similar
          </button>
          <button
            type="button"
            className={`button${tool === 'pan' ? ' button--active' : ''}`}
            aria-pressed={tool === 'pan'}
            onClick={() => onToolChange('pan')}
            data-testid="tool-pan"
          >
            Pan
          </button>
        </div>
      </section>

      {tool === 'similar' ? (
        <section className="mask-toolbar__section">
          <h3>Select similar</h3>
          <p className="mask-toolbar__hint">
            Click the garment (Keep) or backdrop (Remove). Uses color distance —
            not AI. Avoids keeping the whole card behind the shirt.
          </p>
          <label className="mask-toolbar__slider">
            Tolerance: {similarTolerance}
            <input
              type="range"
              min={4}
              max={120}
              value={similarTolerance}
              onChange={(event) =>
                onSimilarToleranceChange(Number(event.target.value))
              }
              data-testid="similar-tolerance"
            />
          </label>
          <label className="mask-toolbar__check">
            <input
              type="checkbox"
              checked={similarConnected}
              onChange={(event) =>
                onSimilarConnectedChange(event.target.checked)
              }
              data-testid="similar-connected"
            />
            Connected region only
          </label>
          <button
            type="button"
            className="button"
            onClick={onRemoveCornerBackground}
            data-testid="remove-corner-bg"
          >
            Remove corner background
          </button>
        </section>
      ) : null}

      <section className="mask-toolbar__section">
        <h3>Brush mode</h3>
        <div className="mask-toolbar__row">
          <button
            type="button"
            className={`button${brushMode === 'keep' ? ' button--active' : ''}`}
            aria-pressed={brushMode === 'keep'}
            onClick={() => onBrushModeChange('keep')}
            data-testid="brush-keep"
          >
            Keep
          </button>
          <button
            type="button"
            className={`button${brushMode === 'remove' ? ' button--active' : ''}`}
            aria-pressed={brushMode === 'remove'}
            onClick={() => onBrushModeChange('remove')}
            data-testid="brush-remove"
          >
            Remove
          </button>
        </div>
        <label className="mask-toolbar__slider">
          Size: {brushSize}px
          <input
            type="range"
            min={4}
            max={120}
            value={brushSize}
            onChange={(event) => onBrushSizeChange(Number(event.target.value))}
            data-testid="brush-size"
          />
        </label>
        <div className="mask-toolbar__row">
          {BRUSH_PRESETS.map((size) => (
            <button
              key={size}
              type="button"
              className={`button button--ghost${
                brushSize === size ? ' button--active' : ''
              }`}
              onClick={() => onBrushSizeChange(size)}
            >
              {size}
            </button>
          ))}
        </div>
      </section>

      {tool === 'polygon' ? (
        <section className="mask-toolbar__section">
          <h3>Polygon</h3>
          <p className="mask-toolbar__hint">
            Click to add points. Double-click to close. Points: {polygonPointCount}
          </p>
          <div className="mask-toolbar__row">
            <button
              type="button"
              className="button"
              disabled={polygonPointCount < 3}
              onClick={() => onApplyPolygon('keep')}
              data-testid="polygon-add"
            >
              Add to mask
            </button>
            <button
              type="button"
              className="button"
              disabled={polygonPointCount < 3}
              onClick={() => onApplyPolygon('remove')}
              data-testid="polygon-remove"
            >
              Remove from mask
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={polygonPointCount === 0}
              onClick={onCancelPolygon}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <section className="mask-toolbar__section">
        <h3>Mask actions</h3>
        <div className="mask-toolbar__row">
          <button
            type="button"
            className="button"
            disabled={!canUndo}
            onClick={onUndo}
            data-testid="mask-undo"
          >
            Undo
          </button>
          <button
            type="button"
            className="button"
            disabled={!canRedo}
            onClick={onRedo}
            data-testid="mask-redo"
          >
            Redo
          </button>
          <button
            type="button"
            className="button"
            onClick={onClearMask}
            data-testid="mask-clear"
          >
            Clear
          </button>
          <button
            type="button"
            className="button"
            onClick={onInvertMask}
            data-testid="mask-invert"
          >
            Invert
          </button>
        </div>
      </section>

      <section className="mask-toolbar__section">
        <h3>Refine</h3>
        <p className="mask-toolbar__hint">
          Conventional mask cleanup only — opening/closing, hole fill, and edge
          feather. Never edits original garment pixels.
        </p>
        <div className="mask-toolbar__row">
          <button
            type="button"
            className="button"
            onClick={onMorphOpen}
            data-testid="mask-morph-open"
            title="Remove small keep speckles"
          >
            Smooth spikes
          </button>
          <button
            type="button"
            className="button"
            onClick={onMorphClose}
            data-testid="mask-morph-close"
            title="Fill small gaps in the keep region"
          >
            Fill gaps
          </button>
          <button
            type="button"
            className="button"
            onClick={onFillHoles}
            data-testid="mask-fill-holes"
          >
            Fill holes
          </button>
        </div>
        <label className="mask-toolbar__slider">
          Feather radius: {featherRadius}px
          <input
            type="range"
            min={1}
            max={12}
            value={featherRadius}
            onChange={(event) =>
              onFeatherRadiusChange(Number(event.target.value))
            }
            data-testid="feather-radius"
          />
        </label>
        <div className="mask-toolbar__row">
          <button
            type="button"
            className="button"
            onClick={onFeatherEdges}
            data-testid="mask-feather"
          >
            Feather edges
          </button>
        </div>
      </section>

      <section className="mask-toolbar__section">
        <h3>Zoom ({scalePercent}%)</h3>
        <div className="mask-toolbar__row">
          <button type="button" className="button" onClick={onZoomOut}>
            −
          </button>
          <button type="button" className="button" onClick={onZoomIn}>
            +
          </button>
          <button type="button" className="button button--ghost" onClick={onZoomReset}>
            100%
          </button>
          <button type="button" className="button button--ghost" onClick={onFit}>
            Fit
          </button>
        </div>
        <p className="mask-toolbar__hint">
          Pan: middle-mouse, Space+drag, or Pan tool. Zoom does not change image
          resolution.
        </p>
      </section>
    </aside>
  )
}
