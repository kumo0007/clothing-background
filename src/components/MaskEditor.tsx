import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createImageId } from '../utils/imageFiles'
import { loadHtmlImage } from '../lib/image/loadHtmlImage'
import { clearMaskBuffer } from '../lib/mask/createMask'
import { invertMaskBuffer } from '../lib/mask/invertMask'
import { MaskHistory } from '../lib/mask/maskHistory'
import { getOrCreateMask, setMask } from '../lib/mask/maskStore'
import { paintMaskStroke } from '../lib/mask/paintMask'
import {
  fillPolygonOnMask,
  type PolygonPoint,
} from '../lib/mask/polygonMask'
import {
  featherMaskEdges,
  fillMaskHoles,
  morphCloseMask,
  morphOpenMask,
} from '../lib/mask/refineMask'
import {
  chokeMaskEdgeFringe,
  floodSelectSimilar,
  globalSelectSimilar,
  removeBrightEdgeChrome,
  removeSimilarToCorners,
  stripBorderConnectedStudio,
  stripEnclosedFlatStudio,
} from '../lib/mask/selectSimilar'
import {
  clampScale,
  fitTransform,
  screenToImage,
  zoomAtPoint,
  type ViewTransform,
} from '../lib/rendering/coords'
import {
  renderComposite,
  renderEditOverlay,
  renderMaskPreview,
} from '../lib/rendering/renderComposite'
import { createDefaultBackground } from '../types/background'
import type {
  BackgroundState,
  SharedBackgroundImage,
  UploadedImage,
} from '../types'
import type { BrushMode, EditorTool, EditorViewMode } from '../types/mask'
import { BackgroundPanel } from './BackgroundPanel'
import { MaskToolbar } from './MaskToolbar'
import './MaskEditor.css'

type MaskEditorProps = {
  image: UploadedImage
  background: BackgroundState
  sharedBackgrounds: SharedBackgroundImage[]
  onBackgroundChange: (next: BackgroundState) => void
  onSharedBackgroundAdded: (asset: SharedBackgroundImage) => void
  onMaskEdited: () => void
  onClose: () => void
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4]

export function MaskEditor({
  image,
  background,
  sharedBackgrounds,
  onBackgroundChange,
  onSharedBackgroundAdded,
  onMaskEdited,
  onClose,
}: MaskEditorProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef(new MaskHistory())
  const maskRef = useRef(getOrCreateMask(image.id, image.width, image.height))
  const originalImageRef = useRef<HTMLImageElement | null>(null)
  const originalImageDataRef = useRef<ImageData | null>(null)
  const backgroundImageRef = useRef<HTMLImageElement | null>(null)
  const paintingRef = useRef(false)
  const panningRef = useRef(false)
  const spaceDownRef = useRef(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const lastPointRef = useRef<PolygonPoint | null>(null)
  const panStartRef = useRef<{ x: number; y: number; transform: ViewTransform } | null>(
    null,
  )
  const transformRef = useRef<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 })
  const rafRef = useRef<number | null>(null)
  const dirtyRef = useRef(true)

  const [tool, setTool] = useState<EditorTool>('brush')
  const [brushMode, setBrushMode] = useState<BrushMode>('keep')
  const [brushSize, setBrushSize] = useState(30)
  const [viewMode, setViewMode] = useState<EditorViewMode>('edit')
  const [showOverlay, setShowOverlay] = useState(true)
  const [transform, setTransform] = useState<ViewTransform>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  })
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [polygonPoints, setPolygonPoints] = useState<PolygonPoint[]>([])
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [similarTolerance, setSimilarTolerance] = useState(36)
  const [featherRadius, setFeatherRadius] = useState(2)
  const [similarConnected, setSimilarConnected] = useState(true)

  transformRef.current = transform

  const applyTransform = useCallback((next: ViewTransform) => {
    transformRef.current = next
    setTransform(next)
  }, [])

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(historyRef.current.canUndo)
    setCanRedo(historyRef.current.canRedo)
  }, [])

  const markDirty = useCallback(() => {
    dirtyRef.current = true
  }, [])

  const commitMaskChange = useCallback(() => {
    setMask(image.id, maskRef.current)
    onMaskEdited()
    syncHistoryFlags()
    markDirty()
  }, [image.id, markDirty, onMaskEdited, syncHistoryFlags])

  const withHistory = useCallback(
    (mutate: () => void) => {
      historyRef.current.push(maskRef.current)
      mutate()
      commitMaskChange()
    },
    [commitMaskChange],
  )

  // Load original image + switch mask when image changes.
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setLoadError(null)
    historyRef.current = new MaskHistory()
    maskRef.current = getOrCreateMask(image.id, image.width, image.height)
    setPolygonPoints([])
    syncHistoryFlags()

    loadHtmlImage(image.objectUrl)
      .then((img) => {
        if (cancelled) {
          return
        }
        originalImageRef.current = img
        const probe = document.createElement('canvas')
        probe.width = image.width
        probe.height = image.height
        const probeCtx = probe.getContext('2d')
        if (probeCtx) {
          probeCtx.drawImage(img, 0, 0, image.width, image.height)
          originalImageDataRef.current = probeCtx.getImageData(
            0,
            0,
            image.width,
            image.height,
          )
        } else {
          originalImageDataRef.current = null
        }
        setReady(true)
        markDirty()
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Could not load the original image for editing.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [image.id, image.objectUrl, image.width, image.height, markDirty, syncHistoryFlags])

  // Load background image when needed.
  useEffect(() => {
    let cancelled = false
    backgroundImageRef.current = null
    if (background.type !== 'image' || !background.imageUrl) {
      markDirty()
      return
    }
    loadHtmlImage(background.imageUrl)
      .then((img) => {
        if (cancelled) {
          return
        }
        backgroundImageRef.current = img
        markDirty()
      })
      .catch(() => {
        if (!cancelled) {
          backgroundImageRef.current = null
          markDirty()
        }
      })
    return () => {
      cancelled = true
    }
  }, [background.type, background.imageUrl, markDirty])

  // Fit once when the image becomes ready.
  useEffect(() => {
    if (!ready) {
      return
    }
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    applyTransform(
      fitTransform(
        image.width,
        image.height,
        viewport.clientWidth,
        viewport.clientHeight,
      ),
    )
    markDirty()
  }, [ready, image.width, image.height, markDirty, applyTransform])

  const redraw = useCallback(() => {
    const canvas = displayCanvasRef.current
    const original = originalImageRef.current
    if (!canvas || !original) {
      return
    }

    const mask = maskRef.current
    const width = image.width
    const height = image.height

    if (viewMode === 'mask') {
      renderMaskPreview(canvas, mask)
    } else if (viewMode === 'result') {
      renderComposite(
        canvas,
        original,
        mask,
        background,
        backgroundImageRef.current,
      )
    } else if (viewMode === 'original') {
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(original, 0, 0, width, height)
    } else if (showOverlay) {
      renderEditOverlay(canvas, original, mask, width, height)
    } else {
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(original, 0, 0, width, height)
    }

    // Draw polygon overlay into a separate pass on the same canvas (edit aids only).
    if (
      (viewMode === 'edit' || viewMode === 'original') &&
      polygonPoints.length > 0
    ) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.save()
        ctx.strokeStyle = '#3ecf8e'
        ctx.fillStyle = 'rgba(62, 207, 142, 0.2)'
        ctx.lineWidth = Math.max(1, 2 / transformRef.current.scale)
        ctx.beginPath()
        ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y)
        for (let i = 1; i < polygonPoints.length; i += 1) {
          ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y)
        }
        ctx.stroke()
        for (const point of polygonPoints) {
          ctx.beginPath()
          ctx.arc(point.x, point.y, Math.max(2, 4 / transformRef.current.scale), 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }
    }

    dirtyRef.current = false
  }, [background, image.height, image.width, polygonPoints, showOverlay, viewMode])

  useEffect(() => {
    markDirty()
  }, [background, viewMode, showOverlay, polygonPoints, transform, markDirty])

  useEffect(() => {
    if (!ready) {
      return
    }
    let active = true
    const loop = () => {
      if (!active) {
        return
      }
      if (dirtyRef.current) {
        redraw()
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      active = false
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [ready, redraw])

  const getLocalPoint = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    if (!viewport) {
      return { x: 0, y: 0 }
    }
    const rect = viewport.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }, [])

  const beginStroke = useCallback(
    (imagePoint: PolygonPoint) => {
      historyRef.current.push(maskRef.current)
      paintMaskStroke(
        maskRef.current,
        imagePoint.x,
        imagePoint.y,
        imagePoint.x,
        imagePoint.y,
        brushSize / 2,
        brushMode,
      )
      lastPointRef.current = imagePoint
      paintingRef.current = true
      markDirty()
    },
    [brushMode, brushSize, markDirty],
  )

  const continueStroke = useCallback(
    (imagePoint: PolygonPoint) => {
      const last = lastPointRef.current
      if (!last) {
        return
      }
      paintMaskStroke(
        maskRef.current,
        last.x,
        last.y,
        imagePoint.x,
        imagePoint.y,
        brushSize / 2,
        brushMode,
      )
      lastPointRef.current = imagePoint
      markDirty()
    },
    [brushMode, brushSize, markDirty],
  )

  const endStroke = useCallback(() => {
    if (!paintingRef.current) {
      return
    }
    paintingRef.current = false
    lastPointRef.current = null
    commitMaskChange()
  }, [commitMaskChange])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!ready || viewMode === 'mask' || viewMode === 'result') {
      return
    }
    const local = getLocalPoint(event)
    const imagePoint = screenToImage(local.x, local.y, transformRef.current)
    const wantsPan =
      tool === 'pan' ||
      event.button === 1 ||
      (event.button === 0 && spaceDownRef.current)

    if (wantsPan) {
      event.preventDefault()
      panningRef.current = true
      panStartRef.current = {
        x: local.x,
        y: local.y,
        transform: { ...transformRef.current },
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    if (tool === 'polygon' && event.button === 0) {
      event.preventDefault()
      if (event.detail >= 2 && polygonPoints.length >= 3) {
        // Double-click closes the polygon; apply via toolbar Add/Remove.
        markDirty()
        return
      }
      setPolygonPoints((prev) => {
        if (prev.length >= 3) {
          const first = prev[0]
          const closeDistance = 8 / transformRef.current.scale
          if (
            Math.hypot(imagePoint.x - first.x, imagePoint.y - first.y) <=
            closeDistance
          ) {
            return prev
          }
        }
        return [...prev, imagePoint]
      })
      markDirty()
      return
    }

    if (tool === 'similar' && event.button === 0 && viewMode === 'edit') {
      event.preventDefault()
      const source = originalImageDataRef.current
      if (!source) {
        return
      }
      withHistory(() => {
        if (similarConnected) {
          floodSelectSimilar(
            maskRef.current,
            source,
            imagePoint.x,
            imagePoint.y,
            similarTolerance,
            brushMode,
          )
        } else {
          globalSelectSimilar(
            maskRef.current,
            source,
            imagePoint.x,
            imagePoint.y,
            similarTolerance,
            brushMode,
          )
        }
      })
      return
    }

    if (tool === 'brush' && event.button === 0 && viewMode === 'edit') {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      beginStroke(imagePoint)
    }
  }

  const handleRemoveCornerBackground = () => {
    const source = originalImageDataRef.current
    if (!source) {
      return
    }
    withHistory(() => {
      // First preserve everything, then punch out backdrop-like corner colors.
      maskRef.current.data.fill(255)
      removeSimilarToCorners(maskRef.current, source, Math.max(similarTolerance, 28))
    })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const local = getLocalPoint(event)
    setCursorPos(local)

    if (panningRef.current && panStartRef.current) {
      const start = panStartRef.current
      applyTransform({
        scale: start.transform.scale,
        offsetX: start.transform.offsetX + (local.x - start.x),
        offsetY: start.transform.offsetY + (local.y - start.y),
      })
      return
    }

    if (paintingRef.current) {
      const imagePoint = screenToImage(local.x, local.y, transformRef.current)
      continueStroke(imagePoint)
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panningRef.current) {
      panningRef.current = false
      panStartRef.current = null
    }
    endStroke()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onDoubleClick = () => {
    if (tool === 'polygon' && polygonPoints.length >= 3) {
      // Leave points; user chooses Add/Remove in toolbar.
      markDirty()
    }
  }

  const handleUndo = useCallback(() => {
    const previous = historyRef.current.undo(maskRef.current)
    if (!previous) {
      return
    }
    maskRef.current = previous
    commitMaskChange()
  }, [commitMaskChange])

  const handleRedo = useCallback(() => {
    const next = historyRef.current.redo(maskRef.current)
    if (!next) {
      return
    }
    maskRef.current = next
    commitMaskChange()
  }, [commitMaskChange])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat) {
        spaceDownRef.current = true
        setSpaceDown(true)
        event.preventDefault()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceDownRef.current = false
        setSpaceDown(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [handleRedo, handleUndo])

  const handleClear = () => {
    if (!window.confirm('Clear the mask? Everything will become background (black).')) {
      return
    }
    withHistory(() => {
      clearMaskBuffer(maskRef.current, 0)
    })
  }

  const handleInvert = () => {
    if (!window.confirm('Invert the mask? White and black areas will swap.')) {
      return
    }
    withHistory(() => {
      invertMaskBuffer(maskRef.current)
    })
  }

  const handleApplyPolygon = (mode: BrushMode) => {
    if (polygonPoints.length < 3) {
      return
    }
    withHistory(() => {
      fillPolygonOnMask(maskRef.current, polygonPoints, mode)
    })
    setPolygonPoints([])
  }

  /** Close/feather can reintroduce studio fringe + chrome — clean again. */
  const cleanupEdgesIfPossible = () => {
    const source = originalImageDataRef.current
    if (!source) {
      return
    }
    chokeMaskEdgeFringe(maskRef.current, source, 40, { restoreTexture: false })
    removeBrightEdgeChrome(maskRef.current, source)
    stripBorderConnectedStudio(maskRef.current, source)
    stripEnclosedFlatStudio(maskRef.current, source)
  }

  const handleMorphOpen = () => {
    withHistory(() => {
      morphOpenMask(maskRef.current, 1)
    })
  }

  const handleMorphClose = () => {
    withHistory(() => {
      morphCloseMask(maskRef.current, 1)
      cleanupEdgesIfPossible()
    })
  }

  const handleFillHoles = () => {
    withHistory(() => {
      fillMaskHoles(maskRef.current)
      cleanupEdgesIfPossible()
    })
  }

  const handleFeatherEdges = () => {
    withHistory(() => {
      // Clean fringe first, then inward-feather (cleanup after would harden edges).
      cleanupEdgesIfPossible()
      featherMaskEdges(maskRef.current, featherRadius)
    })
  }

  const zoomByStep = (direction: 1 | -1) => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const current = transformRef.current.scale
    const nextScale =
      direction > 0
        ? (ZOOM_STEPS.find((step) => step > current + 0.001) ??
          ZOOM_STEPS[ZOOM_STEPS.length - 1])
        : ([...ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ??
          ZOOM_STEPS[0])
    applyTransform(
      zoomAtPoint(
        transformRef.current,
        viewport.clientWidth / 2,
        viewport.clientHeight / 2,
        nextScale,
      ),
    )
  }

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const local = {
      x: event.clientX - event.currentTarget.getBoundingClientRect().left,
      y: event.clientY - event.currentTarget.getBoundingClientRect().top,
    }
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
    applyTransform(
      zoomAtPoint(
        transformRef.current,
        local.x,
        local.y,
        clampScale(transformRef.current.scale * factor),
      ),
    )
  }

  const handleUploadBackground = (file: File) => {
    const objectUrl = URL.createObjectURL(file)
    const asset = {
      id: createImageId(),
      objectUrl,
      name: file.name,
    }
    onSharedBackgroundAdded(asset)
    onBackgroundChange({
      ...background,
      type: 'image',
      imageUrl: objectUrl,
      imageName: file.name,
    })
  }

  const brushCursorSize = brushSize * transform.scale
  const scalePercent = Math.round(transform.scale * 100)

  const canvasStyle = useMemo(
    () => ({
      width: image.width * transform.scale,
      height: image.height * transform.scale,
      transform: `translate(${transform.offsetX}px, ${transform.offsetY}px)`,
      transformOrigin: '0 0' as const,
    }),
    [image.height, image.width, transform],
  )

  return (
    <div className="mask-editor" data-testid="mask-editor">
      <header className="mask-editor__header">
        <button
          type="button"
          className="button"
          onClick={onClose}
          data-testid="mask-back"
        >
          Back
        </button>
        <div className="mask-editor__title">
          <strong>Mask Editor</strong>
          <span>{image.name}</span>
        </div>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => {
            if (
              !window.confirm(
                'Reset mask to all-black and clear the background for this image?',
              )
            ) {
              return
            }
            historyRef.current.clear()
            clearMaskBuffer(maskRef.current, 0)
            setMask(image.id, maskRef.current)
            onBackgroundChange(createDefaultBackground())
            onMaskEdited()
            syncHistoryFlags()
            markDirty()
          }}
          data-testid="mask-reset-all"
        >
          Reset mask + background
        </button>
      </header>

      {loadError ? (
        <p className="app__error" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="mask-editor__body">
        <div
          ref={viewportRef}
          className={`mask-editor__viewport${
            tool === 'pan' || spaceDown ? ' mask-editor__viewport--pan' : ''
          }`}
          data-testid="mask-viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onWheel={handleWheel}
        >
          <canvas
            ref={displayCanvasRef}
            className="mask-editor__canvas"
            style={canvasStyle}
            aria-label="Mask editing canvas"
            data-testid="mask-canvas"
          />
          {tool === 'brush' &&
          viewMode === 'edit' &&
          cursorPos &&
          !spaceDown ? (
            <div
              ref={cursorRef}
              className="mask-editor__brush-cursor"
              style={{
                width: brushCursorSize,
                height: brushCursorSize,
                left: cursorPos.x,
                top: cursorPos.y,
                borderColor: brushMode === 'keep' ? '#3ecf8e' : '#ff7b72',
              }}
            />
          ) : null}
          {!ready ? (
            <p className="mask-editor__loading">Loading image…</p>
          ) : null}
        </div>

        <div className="mask-editor__side">
          <MaskToolbar
            tool={tool}
            brushMode={brushMode}
            brushSize={brushSize}
            viewMode={viewMode}
            showOverlay={showOverlay}
            scalePercent={scalePercent}
            canUndo={canUndo}
            canRedo={canRedo}
            polygonPointCount={polygonPoints.length}
            similarTolerance={similarTolerance}
            similarConnected={similarConnected}
            onToolChange={setTool}
            onBrushModeChange={setBrushMode}
            onBrushSizeChange={setBrushSize}
            onViewModeChange={setViewMode}
            onToggleOverlay={() => setShowOverlay((value) => !value)}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onClearMask={handleClear}
            onInvertMask={handleInvert}
            onZoomIn={() => zoomByStep(1)}
            onZoomOut={() => zoomByStep(-1)}
            onZoomReset={() => {
              const viewport = viewportRef.current
              if (!viewport) {
                return
              }
              applyTransform(
                zoomAtPoint(
                  transformRef.current,
                  viewport.clientWidth / 2,
                  viewport.clientHeight / 2,
                  1,
                ),
              )
            }}
            onFit={() => {
              const viewport = viewportRef.current
              if (!viewport) {
                return
              }
              applyTransform(
                fitTransform(
                  image.width,
                  image.height,
                  viewport.clientWidth,
                  viewport.clientHeight,
                ),
              )
            }}
            onApplyPolygon={handleApplyPolygon}
            onCancelPolygon={() => setPolygonPoints([])}
            onSimilarToleranceChange={setSimilarTolerance}
            onSimilarConnectedChange={setSimilarConnected}
            onRemoveCornerBackground={handleRemoveCornerBackground}
            featherRadius={featherRadius}
            onFeatherRadiusChange={setFeatherRadius}
            onMorphOpen={handleMorphOpen}
            onMorphClose={handleMorphClose}
            onFillHoles={handleFillHoles}
            onFeatherEdges={handleFeatherEdges}
          />
          <BackgroundPanel
            background={background}
            sharedBackgrounds={sharedBackgrounds}
            onChange={onBackgroundChange}
            onUploadBackground={handleUploadBackground}
            onResetBackground={() => onBackgroundChange(createDefaultBackground())}
          />
        </div>
      </div>
    </div>
  )
}
