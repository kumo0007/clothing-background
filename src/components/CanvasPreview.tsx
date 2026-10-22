import { useEffect, useRef, useState } from 'react'
import { loadHtmlImage } from '../lib/image/loadHtmlImage'
import { getMask } from '../lib/mask/maskStore'
import { renderFinalInto } from '../lib/rendering/renderFinal'
import { createDefaultAdjustments, type ImageAdjustments } from '../types/adjustments'
import { shouldCompositeResult } from '../types/background'
import type { BackgroundState, UploadedImage } from '../types'

type CanvasPreviewProps = {
  image: UploadedImage | null
  background?: BackgroundState | null
  adjustments?: ImageAdjustments | null
  /** Bumps when the per-image mask changes so the preview can refresh. */
  maskRevision?: number
  /** When true and a non-transparent background is set, show the composite. */
  showResult?: boolean
}

export function CanvasPreview({
  image,
  background = null,
  adjustments = null,
  maskRevision = 0,
  showResult = false,
}: CanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'original' | 'result'>('original')
  const [outputSize, setOutputSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    if (!image) {
      const context = canvas.getContext('2d')
      if (context) {
        canvas.width = 1
        canvas.height = 1
        context.clearRect(0, 0, 1, 1)
      }
      setStatus('original')
      setOutputSize({ width: 0, height: 0 })
      return
    }

    let cancelled = false

    const run = async () => {
      try {
        const original = await loadHtmlImage(image.objectUrl)
        if (cancelled) {
          return
        }

        const mask = getMask(image.id)
        const adj = adjustments ?? createDefaultAdjustments()
        const canComposite =
          !!showResult &&
          !!background &&
          shouldCompositeResult(
            true,
            mask !== undefined,
            background,
            adj.shadowOpacity,
          )

        let backgroundImage: HTMLImageElement | null = null
        if (
          canComposite &&
          background?.type === 'image' &&
          background.imageUrl
        ) {
          backgroundImage = await loadHtmlImage(background.imageUrl)
        }
        if (cancelled) {
          return
        }

        renderFinalInto(canvas, {
          original,
          width: image.width || original.naturalWidth,
          height: image.height || original.naturalHeight,
          mask: mask ?? null,
          background,
          backgroundImage,
          adjustments: adj,
          useComposite: !!canComposite,
        })
        setOutputSize({ width: canvas.width, height: canvas.height })
        setStatus(canComposite ? 'result' : 'original')
      } catch {
        if (!cancelled) {
          setStatus('original')
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [image, background, adjustments, maskRevision, showResult])

  if (!image) {
    return (
      <div className="preview preview--empty" data-testid="canvas-preview-empty">
        <p>Select an image to preview it on the canvas.</p>
      </div>
    )
  }

  return (
    <div className="preview" data-testid="canvas-preview">
      <div className="preview__meta">
        <span>{image.name}</span>
        <span>
          {(outputSize.width || image.width)}&nbsp;×&nbsp;
          {(outputSize.height || image.height)}px
          {status === 'result' ? ' · result' : ''}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="preview__canvas"
        aria-label={`Canvas preview of ${image.name}`}
        data-testid="preview-canvas"
      />
    </div>
  )
}
