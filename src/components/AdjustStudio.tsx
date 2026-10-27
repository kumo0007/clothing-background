import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildExportFilename,
  downloadCanvas,
  type ExportFormat,
} from '../lib/export/exportImage'
import { loadHtmlImage } from '../lib/image/loadHtmlImage'
import { isUsableKeepMask } from '../lib/mask/maskKeepRatio'
import { getMask } from '../lib/mask/maskStore'
import { renderFinalInto } from '../lib/rendering/renderFinal'
import {
  clampAdjustValue,
  clampOutputDimension,
  clampShadowBlur,
  clampShadowOffset,
  clampShadowOpacity,
  clampSkewDegrees,
  clampTiltDegrees,
  createDefaultAdjustments,
  normalizeCrop,
  OUTPUT_SIZE_PRESETS,
  SHADOW_PRESETS,
  type ImageAdjustments,
  type OutputFitMode,
  type RotationDegrees,
} from '../types/adjustments'
import type { BackgroundState, UploadedImage } from '../types'
import { shouldCompositeResult } from '../types/background'
import './AdjustStudio.css'

type AdjustStudioProps = {
  image: UploadedImage
  background: BackgroundState
  adjustments: ImageAdjustments
  maskRevision: number
  hasMaskEdits: boolean
  onAdjustmentsChange: (next: ImageAdjustments) => void
  onClose: () => void
}

export function AdjustStudio({
  image,
  background,
  adjustments,
  maskRevision,
  hasMaskEdits,
  onAdjustmentsChange,
  onClose,
}: AdjustStudioProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png')
  const [exporting, setExporting] = useState(false)
  const [previewSize, setPreviewSize] = useState({
    width: image.width,
    height: image.height,
  })

  const storedMask = getMask(image.id)
  const useComposite =
    shouldCompositeResult(
      hasMaskEdits,
      storedMask !== undefined,
      background,
      adjustments.shadowOpacity,
    ) && !!storedMask && isUsableKeepMask(storedMask)

  const patch = useCallback(
    (partial: Partial<ImageAdjustments>) => {
      onAdjustmentsChange({ ...adjustments, ...partial })
    },
    [adjustments, onAdjustmentsChange],
  )

  const redraw = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    try {
      const original = await loadHtmlImage(image.objectUrl)
      let backgroundImage: HTMLImageElement | null = null
      if (background.type === 'image' && background.imageUrl) {
        backgroundImage = await loadHtmlImage(background.imageUrl)
      }
      renderFinalInto(canvas, {
        original,
        width: image.width,
        height: image.height,
        mask: getMask(image.id) ?? null,
        background,
        backgroundImage,
        adjustments,
        useComposite,
      })
      setPreviewSize({ width: canvas.width, height: canvas.height })
      setReady(true)
      setError(null)
    } catch {
      setError('Could not render the adjusted preview.')
    }
  }, [
    adjustments,
    background,
    image.height,
    image.id,
    image.objectUrl,
    image.width,
    maskRevision,
    useComposite,
  ])

  useEffect(() => {
    void redraw()
  }, [redraw])

  const handleExport = async () => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    setExporting(true)
    try {
      await downloadCanvas(
        canvas,
        buildExportFilename(image.name, exportFormat),
        exportFormat,
      )
    } catch {
      setError('Export failed.')
    } finally {
      setExporting(false)
    }
  }

  const crop = adjustments.crop ?? { x: 0, y: 0, width: 1, height: 1 }

  return (
    <div className="adjust-studio" data-testid="adjust-studio">
      <header className="adjust-studio__header">
        <button type="button" className="button" onClick={onClose} data-testid="adjust-back">
          Back
        </button>
        <div className="adjust-studio__title">
          <strong>Adjust &amp; Export</strong>
          <span>{image.name}</span>
        </div>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => onAdjustmentsChange(createDefaultAdjustments())}
          data-testid="adjust-reset"
        >
          Reset adjustments
        </button>
      </header>

      {error ? (
        <p className="app__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="adjust-studio__body">
        <div className="adjust-studio__preview">
          <canvas
            ref={canvasRef}
            className="adjust-studio__canvas"
            aria-label="Adjusted result preview"
            data-testid="adjust-canvas"
          />
          {!ready ? <p className="app__status">Rendering…</p> : null}
        </div>

        <div className="adjust-studio__side">
          <section className="adjust-panel">
            <h3>Color</h3>
            <p className="adjust-panel__hint">
              Explicit color transforms on the composited result. No generative
              fill.
            </p>
            {(
              [
                ['brightness', 'Brightness'],
                ['contrast', 'Contrast'],
                ['saturation', 'Saturation'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="adjust-panel__slider">
                {label}: {adjustments[key]}
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={adjustments[key]}
                  onChange={(event) =>
                    patch({
                      [key]: clampAdjustValue(Number(event.target.value)),
                    })
                  }
                  data-testid={`adjust-${key}`}
                />
              </label>
            ))}
          </section>

          <section className="adjust-panel">
            <h3>Rotate &amp; Skew</h3>
            <div className="adjust-panel__row">
              <button
                type="button"
                className="button"
                onClick={() =>
                  patch({
                    rotation: ((adjustments.rotation + 90) % 360) as RotationDegrees,
                  })
                }
                data-testid="adjust-rotate-cw"
              >
                Rotate 90°
              </button>
              <button
                type="button"
                className={`button${adjustments.flipHorizontal ? ' button--active' : ''}`}
                aria-pressed={adjustments.flipHorizontal}
                onClick={() =>
                  patch({ flipHorizontal: !adjustments.flipHorizontal })
                }
                data-testid="adjust-flip-h"
              >
                Flip H
              </button>
              <button
                type="button"
                className={`button${adjustments.flipVertical ? ' button--active' : ''}`}
                aria-pressed={adjustments.flipVertical}
                onClick={() =>
                  patch({ flipVertical: !adjustments.flipVertical })
                }
                data-testid="adjust-flip-v"
              >
                Flip V
              </button>
            </div>
            <p className="adjust-panel__hint">
              Orientation: {adjustments.rotation}°
              {adjustments.tilt !== 0 ? ` + tilt ${adjustments.tilt}°` : ''}
            </p>
            <label className="adjust-panel__slider">
              Slight tilt: {adjustments.tilt}°
              <input
                type="range"
                min={-15}
                max={15}
                value={adjustments.tilt}
                onChange={(event) =>
                  patch({
                    tilt: clampTiltDegrees(Number(event.target.value)),
                  })
                }
                data-testid="adjust-tilt"
              />
            </label>
            <p className="adjust-panel__hint">
              Skew shears the composited result (no generative fill).
            </p>
            <label className="adjust-panel__slider">
              Skew X: {adjustments.skewX}°
              <input
                type="range"
                min={-45}
                max={45}
                value={adjustments.skewX}
                onChange={(event) =>
                  patch({
                    skewX: clampSkewDegrees(Number(event.target.value)),
                  })
                }
                data-testid="adjust-skew-x"
              />
            </label>
            <label className="adjust-panel__slider">
              Skew Y: {adjustments.skewY}°
              <input
                type="range"
                min={-45}
                max={45}
                value={adjustments.skewY}
                onChange={(event) =>
                  patch({
                    skewY: clampSkewDegrees(Number(event.target.value)),
                  })
                }
                data-testid="adjust-skew-y"
              />
            </label>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => patch({ skewX: 0, skewY: 0 })}
              data-testid="adjust-skew-reset"
            >
              Reset skew
            </button>
          </section>

          <section className="adjust-panel">
            <h3>Crop</h3>
            <p className="adjust-panel__hint">
              Normalized crop (0–1) of the image before rotation.
            </p>
            <div className="adjust-panel__grid">
              {(
                [
                  ['x', 'X'],
                  ['y', 'Y'],
                  ['width', 'Width'],
                  ['height', 'Height'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={Number(crop[key].toFixed(2))}
                    onChange={(event) => {
                      const next = normalizeCrop({
                        ...crop,
                        [key]: Number(event.target.value),
                      })
                      const isFull =
                        next.x === 0 &&
                        next.y === 0 &&
                        next.width === 1 &&
                        next.height === 1
                      patch({ crop: isFull ? null : next })
                    }}
                    data-testid={`crop-${key}`}
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => patch({ crop: null })}
              data-testid="crop-clear"
            >
              Clear crop
            </button>
          </section>

          <section className="adjust-panel">
            <h3>Frame</h3>
            <p className="adjust-panel__hint">
              Subtle border around the finished image. Does not change garment
              pixels.
            </p>
            <label className="adjust-panel__slider">
              Width: {adjustments.borderWidth}px
              <input
                type="range"
                min={0}
                max={80}
                value={adjustments.borderWidth}
                onChange={(event) =>
                  patch({ borderWidth: Number(event.target.value) })
                }
                data-testid="adjust-border-width"
              />
            </label>
            <label className="adjust-panel__color">
              Color
              <input
                type="color"
                value={adjustments.borderColor}
                onChange={(event) => patch({ borderColor: event.target.value })}
                data-testid="adjust-border-color"
              />
            </label>
          </section>

          <section className="adjust-panel">
            <h3>Shadow</h3>
            <p className="adjust-panel__hint">
              Soft drop / contact shadow from the mask silhouette. Needs a mask;
              garment pixels stay untouched.
            </p>
            {!hasMaskEdits ? (
              <p className="adjust-panel__hint" data-testid="shadow-needs-mask">
                Paint or auto-mask the garment first to enable shadows.
              </p>
            ) : null}
            <div className="adjust-panel__row">
              {SHADOW_PRESETS.map((preset) => {
                const active =
                  adjustments.shadowOpacity === preset.opacity &&
                  adjustments.shadowBlur === preset.blur &&
                  adjustments.shadowOffsetX === preset.offsetX &&
                  adjustments.shadowOffsetY === preset.offsetY
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`button button--ghost${active ? ' button--active' : ''}`}
                    aria-pressed={active}
                    disabled={!hasMaskEdits && preset.opacity > 0}
                    onClick={() =>
                      patch({
                        shadowBlur: preset.blur,
                        shadowOffsetX: preset.offsetX,
                        shadowOffsetY: preset.offsetY,
                        shadowOpacity: preset.opacity,
                      })
                    }
                    data-testid={`shadow-preset-${preset.id}`}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
            <label className="adjust-panel__slider">
              Opacity: {adjustments.shadowOpacity}%
              <input
                type="range"
                min={0}
                max={100}
                value={adjustments.shadowOpacity}
                disabled={!hasMaskEdits}
                onChange={(event) =>
                  patch({
                    shadowOpacity: clampShadowOpacity(Number(event.target.value)),
                  })
                }
                data-testid="adjust-shadow-opacity"
              />
            </label>
            <label className="adjust-panel__slider">
              Blur: {adjustments.shadowBlur}px
              <input
                type="range"
                min={0}
                max={64}
                value={adjustments.shadowBlur}
                disabled={!hasMaskEdits}
                onChange={(event) =>
                  patch({
                    shadowBlur: clampShadowBlur(Number(event.target.value)),
                  })
                }
                data-testid="adjust-shadow-blur"
              />
            </label>
            <label className="adjust-panel__slider">
              Offset X: {adjustments.shadowOffsetX}px
              <input
                type="range"
                min={-48}
                max={48}
                value={adjustments.shadowOffsetX}
                disabled={!hasMaskEdits}
                onChange={(event) =>
                  patch({
                    shadowOffsetX: clampShadowOffset(Number(event.target.value)),
                  })
                }
                data-testid="adjust-shadow-offset-x"
              />
            </label>
            <label className="adjust-panel__slider">
              Offset Y: {adjustments.shadowOffsetY}px
              <input
                type="range"
                min={-48}
                max={48}
                value={adjustments.shadowOffsetY}
                disabled={!hasMaskEdits}
                onChange={(event) =>
                  patch({
                    shadowOffsetY: clampShadowOffset(Number(event.target.value)),
                  })
                }
                data-testid="adjust-shadow-offset-y"
              />
            </label>
            <label className="adjust-panel__color">
              Color
              <input
                type="color"
                value={adjustments.shadowColor}
                disabled={!hasMaskEdits}
                onChange={(event) => patch({ shadowColor: event.target.value })}
                data-testid="adjust-shadow-color"
              />
            </label>
          </section>

          <section className="adjust-panel">
            <h3>Output size</h3>
            <p className="adjust-panel__hint">
              Resize the final composite into a catalog canvas. Does not invent
              garment pixels — only scales what is already composited.
            </p>
            <div className="adjust-panel__row">
              {OUTPUT_SIZE_PRESETS.map((preset) => {
                const active =
                  adjustments.outputWidth === preset.width &&
                  adjustments.outputHeight === preset.height
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`button button--ghost${active ? ' button--active' : ''}`}
                    aria-pressed={active}
                    onClick={() =>
                      patch({
                        outputWidth: preset.width,
                        outputHeight: preset.height,
                      })
                    }
                    data-testid={`output-preset-${preset.id}`}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
            <div className="adjust-panel__grid">
              <label>
                Width
                <input
                  type="number"
                  min={64}
                  max={4096}
                  step={1}
                  value={adjustments.outputWidth ?? ''}
                  placeholder="auto"
                  onChange={(event) => {
                    const raw = event.target.value
                    patch({
                      outputWidth:
                        raw === ''
                          ? null
                          : clampOutputDimension(Number(raw)),
                      outputHeight:
                        raw === ''
                          ? null
                          : (adjustments.outputHeight ??
                            clampOutputDimension(Number(raw))),
                    })
                  }}
                  data-testid="output-width"
                />
              </label>
              <label>
                Height
                <input
                  type="number"
                  min={64}
                  max={4096}
                  step={1}
                  value={adjustments.outputHeight ?? ''}
                  placeholder="auto"
                  onChange={(event) => {
                    const raw = event.target.value
                    patch({
                      outputHeight:
                        raw === ''
                          ? null
                          : clampOutputDimension(Number(raw)),
                      outputWidth:
                        raw === ''
                          ? null
                          : (adjustments.outputWidth ??
                            clampOutputDimension(Number(raw))),
                    })
                  }}
                  data-testid="output-height"
                />
              </label>
            </div>
            <label className="adjust-panel__slider">
              Fit
              <select
                value={adjustments.outputFit}
                onChange={(event) =>
                  patch({ outputFit: event.target.value as OutputFitMode })
                }
                data-testid="output-fit"
              >
                <option value="contain">Contain (pad)</option>
                <option value="cover">Cover (crop)</option>
                <option value="stretch">Stretch</option>
              </select>
            </label>
            <label className="adjust-panel__color">
              Pad color
              <input
                type="color"
                value={adjustments.outputPadColor}
                onChange={(event) =>
                  patch({ outputPadColor: event.target.value })
                }
                disabled={adjustments.outputFit === 'stretch'}
                data-testid="output-pad-color"
              />
            </label>
          </section>

          <section className="adjust-panel">
            <h3>Export</h3>
            <p className="adjust-panel__hint">
              Output {previewSize.width}×{previewSize.height}px · local download
              only
            </p>
            <label className="adjust-panel__slider">
              Format
              <select
                value={exportFormat}
                onChange={(event) =>
                  setExportFormat(event.target.value as ExportFormat)
                }
                data-testid="export-format"
              >
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
              </select>
            </label>
            <button
              type="button"
              className="button"
              disabled={!ready || exporting}
              onClick={() => void handleExport()}
              data-testid="export-download"
            >
              {exporting ? 'Exporting…' : 'Download'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
