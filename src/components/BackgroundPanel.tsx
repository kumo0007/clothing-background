import { useRef } from 'react'
import {
  BACKGROUND_ACCEPT,
  isBackgroundImageFile,
} from '../lib/image/loadHtmlImage'
import type {
  BackgroundFitMode,
  BackgroundState,
  SharedBackgroundImage,
} from '../types/background'

type BackgroundPanelProps = {
  background: BackgroundState
  sharedBackgrounds: SharedBackgroundImage[]
  onChange: (next: BackgroundState) => void
  onUploadBackground: (file: File) => void
  onResetBackground: () => void
}

export function BackgroundPanel({
  background,
  sharedBackgrounds,
  onChange,
  onUploadBackground,
  onResetBackground,
}: BackgroundPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <section className="background-panel" data-testid="background-panel">
      <h3>Background</h3>
      <p className="background-panel__hint">
        Replacement is composited under the masked garment. Original garment
        pixels are never regenerated.
      </p>

      <div className="background-panel__types" role="radiogroup" aria-label="Background type">
        {(
          [
            ['color', 'Color'],
            ['image', 'Image'],
            ['transparent', 'Transparent'],
          ] as const
        ).map(([type, label]) => (
          <label key={type} className="background-panel__radio">
            <input
              type="radio"
              name="bg-type"
              value={type}
              checked={background.type === type}
              onChange={() => onChange({ ...background, type })}
              data-testid={`bg-type-${type}`}
            />
            {label}
          </label>
        ))}
      </div>

      {background.type === 'color' ? (
        <label className="background-panel__color">
          Color
          <input
            type="color"
            value={background.color}
            onChange={(event) =>
              onChange({ ...background, color: event.target.value })
            }
            data-testid="bg-color"
          />
          <input
            type="text"
            value={background.color}
            onChange={(event) =>
              onChange({ ...background, color: event.target.value })
            }
            aria-label="Background color hex"
          />
        </label>
      ) : null}

      {background.type === 'image' ? (
        <div className="background-panel__image">
          <button
            type="button"
            className="button"
            onClick={() => inputRef.current?.click()}
            data-testid="bg-upload"
          >
            Upload background
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={BACKGROUND_ACCEPT}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file && isBackgroundImageFile(file)) {
                onUploadBackground(file)
              }
              event.target.value = ''
            }}
          />

          {sharedBackgrounds.length > 0 ? (
            <div className="background-panel__shared">
              <span>Shared backgrounds</span>
              <ul>
                {sharedBackgrounds.map((asset) => (
                  <li key={asset.id}>
                    <button
                      type="button"
                      className={`button button--ghost${
                        background.imageUrl === asset.objectUrl
                          ? ' button--active'
                          : ''
                      }`}
                      onClick={() =>
                        onChange({
                          ...background,
                          type: 'image',
                          imageUrl: asset.objectUrl,
                          imageName: asset.name,
                        })
                      }
                    >
                      {asset.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <label className="background-panel__fit">
            Fit mode
            <select
              value={background.fitMode}
              onChange={(event) =>
                onChange({
                  ...background,
                  fitMode: event.target.value as BackgroundFitMode,
                })
              }
              data-testid="bg-fit"
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="stretch">Stretch</option>
            </select>
          </label>

          {background.imageName ? (
            <p className="background-panel__hint">Using: {background.imageName}</p>
          ) : (
            <p className="background-panel__hint">No background image selected.</p>
          )}
        </div>
      ) : null}

      {background.type === 'transparent' ? (
        <p className="background-panel__hint">
          Transparent areas show a checkerboard in preview (PNG-friendly).
        </p>
      ) : null}

      <button
        type="button"
        className="button button--ghost"
        onClick={onResetBackground}
        data-testid="bg-reset"
      >
        Reset background
      </button>
    </section>
  )
}
