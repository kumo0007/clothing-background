import { useEffect, useRef, useState } from 'react'
import { loadHtmlImage } from '../lib/image/loadHtmlImage'
import { getMask } from '../lib/mask/maskStore'
import { isUsableKeepMask } from '../lib/mask/maskKeepRatio'
import { renderFinalInto } from '../lib/rendering/renderFinal'
import {
  createDefaultAdjustments,
  type ImageAdjustments,
} from '../types/adjustments'
import { shouldCompositeResult } from '../types/background'
import type { BackgroundState, UploadedImage } from '../types'

type CanvasPreviewProps = {
  image: UploadedImage | null
  background?: BackgroundState | null
  adjustments?: ImageAdjustments | null
  /** Bumps when the per-image mask changes so the preview can refresh. */
  maskRevision?: number
  /** When true and a mask exists, show the composited cutout / result. */
  showResult?: boolean
}

/** Draw the original photo directly — few allocations (Safari-safe after WASM). */
function drawOriginalInto(
  canvas: HTMLCanvasElement,
  original: HTMLImageElement,
  width: number,
  height: number,
): void {
  const w = Math.max(1, width || original.naturalWidth || 1)
  const h = Math.max(1, height || original.naturalHeight || 1)
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Could not create a 2D canvas context for preview.')
  }
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(original, 0, 0, w, h)
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
        if (original.naturalWidth < 1 || original.naturalHeight < 1) {
          throw new Error('Preview image decoded with zero dimensions.')
        }

        const mask = getMask(image.id)
        const adj = adjustments ?? createDefaultAdjustments()
        const width = image.width || original.naturalWidth
        const height = image.height || original.naturalHeight

        // Empty / near-empty KEEP masks would clear the canvas to checkerboard only.
        const maskOk = !!mask && isUsableKeepMask(mask)
        const canComposite =
          !!showResult &&
          !!background &&
          maskOk &&
          shouldCompositeResult(
            true,
            true,
            background,
            adj.shadowOpacity,
          )

        if (!canComposite) {
          drawOriginalInto(canvas, original, width, height)
          if (cancelled) return
          setOutputSize((prev) =>
            prev.width === canvas.width && prev.height === canvas.height
              ? prev
              : { width: canvas.width, height: canvas.height },
          )
          setStatus((prev) => (prev === 'original' ? prev : 'original'))
          return
        }

        let backgroundImage: HTMLImageElement | null = null
        if (background.type === 'image' && background.imageUrl) {
          backgroundImage = await loadHtmlImage(background.imageUrl)
        }
        if (cancelled) {
          return
        }

        try {
          renderFinalInto(canvas, {
            original,
            width,
            height,
            mask: mask ?? null,
            background,
            backgroundImage,
            adjustments: adj,
            useComposite: true,
          })
        } catch {
          // Composite failed (often Safari memory) — never leave a blank canvas.
          drawOriginalInto(canvas, original, width, height)
          if (cancelled) return
          setOutputSize({ width: canvas.width, height: canvas.height })
          setStatus('original')
          return
        }

        if (cancelled) return
        setOutputSize((prev) =>
          prev.width === canvas.width && prev.height === canvas.height
            ? prev
            : { width: canvas.width, height: canvas.height },
        )
        setStatus((prev) => (prev === 'result' ? prev : 'result'))
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
