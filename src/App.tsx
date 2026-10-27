import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdjustStudio } from './components/AdjustStudio'
import { BatchPanel } from './components/BatchPanel'
import { CanvasPreview } from './components/CanvasPreview'
import { ImageUploader } from './components/ImageUploader'
import { MaskEditor } from './components/MaskEditor'
import { ThumbnailGallery } from './components/ThumbnailGallery'
import { ReviewDiagnosticsPanel } from './components/ReviewDiagnosticsPanel'
import { autoMaskCornersForImage } from './lib/batch/autoMaskCorners'
import {
  buildAutoMaskQueue,
  countInFlightMasks,
  countPendingMasks,
} from './lib/batch/buildAutoMaskQueue'
import type { MaskDiagnosticSummary } from './types/mask'
import { buildResultsZip, downloadBlob } from './lib/batch/exportZip'
import type { ExportFormat } from './lib/export/exportImage'
import { isAppleMobileUserAgent } from './lib/mask/bgRemoveDevice'
import { formatBirefNetInitFailureMessage } from './lib/mask/birefNet/errors'
import { clearAllMasks, deleteMask, getMask } from './lib/mask/maskStore'
import {
  createDefaultAdjustments,
  type ImageAdjustments,
} from './types/adjustments'
import { createDefaultBackground } from './types/background'
import type {
  BackgroundState,
  SharedBackgroundImage,
  UploadedImage,
} from './types'
import type { MaskStateMeta } from './types/mask'
import { createEmptyMaskMeta } from './types/mask'
import {
  createImageId,
  describeRejectedImageFiles,
  filesToAttemptDecode,
  isHeicLikeFile,
  loadImageDimensions,
  materializePickedFiles,
} from './utils/imageFiles'
import './App.css'

type GarmentAuditApi = {
  getMask: typeof getMask
  listImages: () => Array<{
    id: string
    name: string
    width: number
    height: number
    objectUrl: string
  }>
  getMaskMeta: (id: string) => MaskStateMeta | undefined
  getTiming: () => Promise<unknown>
}

type StudioMode = 'gallery' | 'mask' | 'adjust'

type ProjectFields = {
  background: BackgroundState
  maskMeta: MaskStateMeta
  adjustments: ImageAdjustments
}

function createProjectFields(): ProjectFields {
  return {
    background: createDefaultBackground(),
    maskMeta: createEmptyMaskMeta(),
    adjustments: createDefaultAdjustments(),
  }
}

function App() {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [mode, setMode] = useState<StudioMode>('gallery')
  const [projects, setProjects] = useState<Record<string, ProjectFields>>({})
  const [sharedBackgrounds, setSharedBackgrounds] = useState<
    SharedBackgroundImage[]
  >([])
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchProgress, setBatchProgress] = useState<string | null>(null)
  const [zipFormat, setZipFormat] = useState<ExportFormat>('png')
  /** Keeps diagnostics panel mounted so Undo peel remains available after apply. */
  const [peelUndoAvailable, setPeelUndoAvailable] = useState(false)
  const imagesRef = useRef(images)
  imagesRef.current = images
  const sharedBackgroundsRef = useRef(sharedBackgrounds)
  sharedBackgroundsRef.current = sharedBackgrounds
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  /** Prevents duplicate Auto-mask runs from double-clicks / re-renders. */
  const autoMaskInFlightRef = useRef(false)
  /** Bumped to invalidate in-flight batch UI updates after Clear / unmount. */
  const batchGenerationRef = useRef(0)

  const selectedImage = useMemo(
    () => images.find((image) => image.id === selectedId) ?? null,
    [images, selectedId],
  )

  useEffect(() => {
    setPeelUndoAvailable(false)
  }, [selectedId])

  const selectedProject = selectedId ? projects[selectedId] : undefined

  const maskedCount = useMemo(
    () =>
      images.reduce((count, image) => {
        const project = projects[image.id]
        const meta = project?.maskMeta
        return meta?.hasEdits && !meta.autoFailed ? count + 1 : count
      }, 0),
    [images, projects],
  )

  const pendingCount = useMemo(
    () => countPendingMasks(images, projects),
    [images, projects],
  )

  const runningCount = useMemo(
    () => countInFlightMasks(images, projects),
    [images, projects],
  )

  const needsReviewById = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const image of images) {
      const meta = projects[image.id]?.maskMeta
      if (meta?.needsReview || meta?.autoFailed) {
        map[image.id] = true
      }
    }
    return map
  }, [images, projects])

  const maskStatusById = useMemo(() => {
    const map: Record<string, 'pending' | 'processing' | 'failed' | 'review'> =
      {}
    for (const image of images) {
      const meta = projects[image.id]?.maskMeta
      if (
        meta?.processingPhase === 'processing' ||
        meta?.processingPhase === 'loading-model'
      ) {
        map[image.id] = 'processing'
      } else if (meta?.autoFailed) {
        map[image.id] = 'failed'
      } else if (meta?.needsReview) {
        map[image.id] = 'review'
      } else if (!meta?.hasEdits) {
        map[image.id] = 'pending'
      }
    }
    return map
  }, [images, projects])

  const reviewCount = useMemo(
    () =>
      images.reduce((count, image) => {
        const meta = projects[image.id]?.maskMeta
        return meta?.needsReview && !meta.autoFailed ? count + 1 : count
      }, 0),
    [images, projects],
  )

  const failedCount = useMemo(
    () =>
      images.reduce((count, image) => {
        return projects[image.id]?.maskMeta.autoFailed ? count + 1 : count
      }, 0),
    [images, projects],
  )

  useEffect(() => {
    return () => {
      batchGenerationRef.current += 1
      autoMaskInFlightRef.current = false
      for (const image of imagesRef.current) {
        URL.revokeObjectURL(image.objectUrl)
      }
      for (const asset of sharedBackgroundsRef.current) {
        URL.revokeObjectURL(asset.objectUrl)
      }
      clearAllMasks()
    }
  }, [])

  // Optional audit bridge for release / physical-device probes (?audit=1).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const enabled = new URLSearchParams(window.location.search).has('audit')
    if (!enabled) return
    const api: GarmentAuditApi = {
      getMask,
      listImages: () =>
        imagesRef.current.map((image) => ({
          id: image.id,
          name: image.name,
          width: image.width,
          height: image.height,
          objectUrl: image.objectUrl,
        })),
      getMaskMeta: (id) => projectsRef.current[id]?.maskMeta,
      getTiming: async () => ({
        initStartedAt: null,
        readyAt: null,
        lastProcessMs: null,
        totalProcessMs: 0,
        processCount: 0,
        lastInitMessage: null,
        lastInitRatio: null,
        backend: 'birefnet-lite-512',
      }),
    }
    ;(window as unknown as { __garmentAudit?: GarmentAuditApi }).__garmentAudit =
      api
    return () => {
      delete (window as unknown as { __garmentAudit?: GarmentAuditApi })
        .__garmentAudit
    }
  }, [])

  const ensureProject = useCallback((id: string) => {
    setProjects((previous) => {
      if (previous[id]) {
        return previous
      }
      return {
        ...previous,
        [id]: createProjectFields(),
      }
    })
  }, [])

  const handleFilesSelected = useCallback(async (files: File[]) => {
    setError(null)
    setIsLoading(true)
    try {
      // iOS gallery Files are path-backed; copy bytes before any createObjectURL.
      const { files: materialized, failures: materializeFailures } =
        await materializePickedFiles(files)
      const attempted = filesToAttemptDecode(materialized)
      if (attempted.length === 0) {
        setError(
          materializeFailures[0] ??
            describeRejectedImageFiles(files) ??
            'No supported image files were selected.',
        )
        return
      }

      const loaded: UploadedImage[] = []
      const decodeFailures: string[] = []
      const heicDecodeFailures: string[] = []
      for (const file of attempted) {
        // Object URL is built from heap-copied bytes (materializePickedFile),
        // not the transient iOS Photos sandbox path.
        const objectUrl = URL.createObjectURL(file)
        try {
          const { width, height } = await loadImageDimensions(file)
          if (width < 1 || height < 1) {
            throw new Error('zero dimensions')
          }
          loaded.push({
            id: createImageId(),
            file,
            name: file.name,
            objectUrl,
            width,
            height,
          })
        } catch {
          URL.revokeObjectURL(objectUrl)
          if (isHeicLikeFile(file)) {
            heicDecodeFailures.push(file.name || 'HEIC photo')
          } else {
            decodeFailures.push(file.name || 'photo')
          }
        }
      }

      if (heicDecodeFailures.length > 0 && loaded.length === 0) {
        setError(
          describeRejectedImageFiles(
            // Prefer originals so empty-type HEIC still gets conversion copy.
            files.length > 0 ? files : materialized,
          ) ??
            `iPhone HEIC/HEIF could not be decoded (${heicDecodeFailures
              .slice(0, 3)
              .join(', ')}). Export as JPEG (Most Compatible) and re-upload.`,
        )
      } else if (heicDecodeFailures.length > 0) {
        setError(
          `Skipped HEIC/HEIF that this browser cannot decode: ${heicDecodeFailures
            .slice(0, 3)
            .join(', ')}${heicDecodeFailures.length > 3 ? '…' : ''}. Export those as JPEG (Most Compatible) and re-upload.`,
        )
      } else if (decodeFailures.length > 0 || materializeFailures.length > 0) {
        const parts = [
          ...materializeFailures.slice(0, 2),
          ...decodeFailures.slice(0, 3).map(
            (name) => `Could not decode ${name}`,
          ),
        ]
        setError(
          parts.slice(0, 3).join(' · ') +
            (parts.length > 3 ? '…' : ''),
        )
      }

      if (loaded.length === 0) {
        return
      }

      setProjects((previous) => {
        const next = { ...previous }
        for (const image of loaded) {
          next[image.id] = createProjectFields()
        }
        return next
      })

      setImages((previous) => [...previous, ...loaded])
      setSelectedId((current) => current ?? loaded[0].id)
      // Upload never starts inference — leave an explicit idle cue for mobile.
      setBatchProgress(
        `${loaded.length} image${loaded.length === 1 ? '' : 's'} uploaded · 0 masked. Tap Auto-mask all to start on-device processing.`,
      )

      // Overlap weight download with reading the CTA on desktop only.
      // On Apple mobile, defer preload until Auto-mask so WASM init does not
      // compete with freshly decoded upload buffers (OOM risk).
      void (async () => {
        try {
          if (
            isAppleMobileUserAgent(
              typeof navigator !== 'undefined' ? navigator.userAgent : '',
              typeof navigator !== 'undefined'
                ? navigator.maxTouchPoints ?? 0
                : 0,
            )
          ) {
            return
          }
          const { preloadBirefNetModel } = await import('./lib/mask/birefNet')
          await preloadBirefNetModel((progress) => {
            if (
              progress.kind !== 'birefnet-init' ||
              progress.status !== 'loading'
            ) {
              return
            }
            if (autoMaskInFlightRef.current) return
            setBatchProgress(
              `${progress.message ?? 'Loading BiRefNet…'} · images ready — tap Auto-mask all when you want to process.`,
            )
          })
        } catch {
          // Surface failures only when Auto-mask is pressed.
        }
      })()
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleRemove = useCallback((id: string) => {
    setImages((previous) => {
      const target = previous.find((image) => image.id === id)
      if (target) {
        URL.revokeObjectURL(target.objectUrl)
      }
      deleteMask(id)
      setProjects((projectsPrevious) => {
        const next = { ...projectsPrevious }
        delete next[id]
        return next
      })
      const next = previous.filter((image) => image.id !== id)
      setSelectedId((current) => {
        if (current !== id) {
          return current
        }
        setMode('gallery')
        return next[0]?.id ?? null
      })
      return next
    })
  }, [])

  const handleClear = useCallback(() => {
    batchGenerationRef.current += 1
    autoMaskInFlightRef.current = false
    setBatchBusy(false)
    setImages((previous) => {
      for (const image of previous) {
        URL.revokeObjectURL(image.objectUrl)
        deleteMask(image.id)
      }
      return []
    })
    setProjects({})
    setSelectedId(null)
    setMode('gallery')
    setError(null)
    setBatchProgress(null)
  }, [])

  const updateSelectedProject = useCallback(
    (updater: (current: ProjectFields) => ProjectFields) => {
      if (!selectedId) {
        return
      }
      setProjects((previous) => {
        const current = previous[selectedId] ?? createProjectFields()
        return {
          ...previous,
          [selectedId]: updater(current),
        }
      })
    },
    [selectedId],
  )

  const handleBackgroundChange = useCallback(
    (next: BackgroundState) => {
      updateSelectedProject((current) => ({ ...current, background: next }))
    },
    [updateSelectedProject],
  )

  const handleAdjustmentsChange = useCallback(
    (next: ImageAdjustments) => {
      updateSelectedProject((current) => ({ ...current, adjustments: next }))
    },
    [updateSelectedProject],
  )

  const handleMaskEdited = useCallback(() => {
    updateSelectedProject((current) => ({
      ...current,
      maskMeta: {
        ...current.maskMeta,
        revision: current.maskMeta.revision + 1,
        hasEdits: true,
        hasManualEdits: true,
        processingPhase: current.maskMeta.needsReview
          ? 'needs-review'
          : 'masked',
        // Keep auto-mask review flags; polygon/brush edits do not clear needsReview.
      },
    }))
  }, [updateSelectedProject])

  const handleDiagnosticRepair = useCallback(
    (
      nextSummary: MaskDiagnosticSummary,
      needsReview: boolean,
      reviewReason?: string,
    ) => {
      updateSelectedProject((current) => ({
        ...current,
        maskMeta: {
          ...current.maskMeta,
          revision: current.maskMeta.revision + 1,
          hasEdits: true,
          hasManualEdits: true,
          needsReview,
          reviewReason: needsReview ? reviewReason : undefined,
          diagnosticSummary: nextSummary,
          autoFailed: false,
          processingPhase: needsReview ? 'needs-review' : 'masked',
        },
      }))
    },
    [updateSelectedProject],
  )

  const handleSharedBackgroundAdded = useCallback(
    (asset: SharedBackgroundImage) => {
      setSharedBackgrounds((previous) => {
        if (previous.some((item) => item.objectUrl === asset.objectUrl)) {
          return previous
        }
        return [...previous, asset]
      })
    },
    [],
  )

  const handleApplyBackgroundToAll = useCallback(() => {
    if (!selectedId) {
      return
    }
    const source =
      projects[selectedId]?.background ?? createDefaultBackground()
    setProjects((previous) => {
      const next = { ...previous }
      for (const image of images) {
        const current = next[image.id] ?? createProjectFields()
        next[image.id] = {
          ...current,
          background: { ...source },
        }
      }
      return next
    })
    setBatchProgress(`Applied background to ${images.length} images.`)
  }, [images, projects, selectedId])

  const handleApplyAdjustmentsToAll = useCallback(() => {
    if (!selectedId) {
      return
    }
    const source =
      projects[selectedId]?.adjustments ?? createDefaultAdjustments()
    setProjects((previous) => {
      const next = { ...previous }
      for (const image of images) {
        const current = next[image.id] ?? createProjectFields()
        next[image.id] = {
          ...current,
          adjustments: { ...source, crop: source.crop ? { ...source.crop } : null },
        }
      }
      return next
    })
    setBatchProgress(`Applied adjustments to ${images.length} images.`)
  }, [images, projects, selectedId])

  const runLocalAutoMask = useCallback(
    async (scope: 'all' | 'failed' | 'selected') => {
      if (autoMaskInFlightRef.current) {
        setBatchProgress('Auto-mask already running…')
        return
      }

      // Always use current image ids from the ref (not a stale closure snapshot).
      const liveImages = imagesRef.current
      const queue = buildAutoMaskQueue(
        liveImages,
        projectsRef.current,
        scope,
        selectedId,
      )

      if (queue.length === 0) {
        setBatchProgress(
          scope === 'failed'
            ? 'No failed images to retry.'
            : scope === 'selected'
              ? 'Select an unmasked or failed image to retry (manual edits are preserved).'
              : liveImages.length === 0
                ? 'No images to auto-mask.'
                : 'All uploaded images already have masks. Use Retry failed for errors, or Clear all to start over.',
        )
        return
      }

      const generation = ++batchGenerationRef.current
      const isCurrent = () => generation === batchGenerationRef.current

      autoMaskInFlightRef.current = true
      setBatchBusy(true)
      setError(null)

      const markQueuePhase = (
        phase: MaskStateMeta['processingPhase'],
        extra?: Partial<MaskStateMeta>,
      ) => {
        if (!isCurrent()) return
        setProjects((previous) => {
          const next = { ...previous }
          for (const image of queue) {
            const current = next[image.id] ?? createProjectFields()
            next[image.id] = {
              ...current,
              maskMeta: {
                ...current.maskMeta,
                processingPhase: phase,
                ...extra,
              },
            }
          }
          return next
        })
      }

      try {
        markQueuePhase('loading-model')
        if (!isCurrent()) return
        setBatchProgress(
          `Loading BiRefNet for ${queue.length} image${
            queue.length === 1 ? '' : 's'
          }…`,
        )
        try {
          const { preloadBirefNetModel } = await import('./lib/mask/birefNet')
          const handle = await preloadBirefNetModel((progress) => {
            if (!isCurrent()) return
            if (progress.kind !== 'birefnet-init') return
            if (progress.status === 'loading') {
              setBatchProgress(progress.message ?? 'Loading BiRefNet…')
            }
          })
          if (!isCurrent()) return
          // Clear loading-model on the whole queue so only the active image shows running.
          markQueuePhase('pending')
          setBatchProgress(
            `BiRefNet ready (${handle.device}). Starting batch… Keep this tab open on iPhone.`,
          )
        } catch (initErr) {
          const raw =
            initErr instanceof Error
              ? initErr.message
              : 'Failed to load BiRefNet.'
          const message = formatBirefNetInitFailureMessage(raw)
          if (!isCurrent()) return
          markQueuePhase('failed', {
            autoFailed: true,
            needsReview: true,
            reviewReason: message,
            diagnosticSummary: undefined,
          })
          setError(message)
          setBatchProgress(`Auto-mask stopped: ${message}`)
          return
        }

        let reviewFlagged = 0
        let successCount = 0
        let failCount = 0
        const methodsSeen = new Set<string>()
        const failures: string[] = []
        // One at a time — keep app concurrency 1 for mobile RAM.
        const concurrency = 1
        let nextIndex = 0

        const runOne = async (image: UploadedImage, ordinal: number) => {
          if (!isCurrent()) return
          setProjects((previous) => {
            const current = previous[image.id] ?? createProjectFields()
            return {
              ...previous,
              [image.id]: {
                ...current,
                maskMeta: {
                  ...current.maskMeta,
                  processingPhase: 'processing',
                },
              },
            }
          })
          setBatchProgress(
            `Auto-masking ${ordinal}/${queue.length}: ${image.name} (on-device)`,
          )
          try {
            const auto = await autoMaskCornersForImage(
              image.id,
              image.objectUrl,
              image.width,
              image.height,
              40,
              (progress) => {
                if (!isCurrent()) return
                if (
                  progress.kind === 'birefnet-init' &&
                  progress.status === 'loading'
                ) {
                  const pct =
                    typeof progress.ratio === 'number'
                      ? Math.round(progress.ratio * 100)
                      : undefined
                  setBatchProgress(
                    `Loading BiRefNet${pct !== undefined ? ` (${pct}%)` : ''}…`,
                  )
                }
                if (progress.kind === 'birefnet-process') {
                  setBatchProgress(
                    `Auto-masking ${ordinal}/${queue.length}: ${image.name} (${progress.stage})`,
                  )
                }
              },
              // Pass File directly — never re-fetch blob: URLs (Firefox/iOS NetworkError).
              image.file,
            )
            if (!isCurrent()) return
            methodsSeen.add(auto.methodUsed)
            successCount += 1
            if (auto.needsReview) reviewFlagged += 1
            setProjects((previous) => {
              const current = previous[image.id] ?? createProjectFields()
              return {
                ...previous,
                [image.id]: {
                  ...current,
                  maskMeta: {
                    revision: current.maskMeta.revision + 1,
                    hasEdits: true,
                    hasManualEdits: false,
                    autoConfidence: auto.confidence,
                    needsReview: auto.needsReview,
                    autoMethodUsed: auto.methodUsed,
                    autoFailed: false,
                    reviewReason: auto.needsReview
                      ? auto.reviewReason
                      : undefined,
                    diagnosticSummary: auto.diagnosticSummary,
                    processingPhase: auto.needsReview
                      ? 'needs-review'
                      : 'masked',
                  },
                },
              }
            })
          } catch (caught) {
            if (!isCurrent()) return
            failCount += 1
            const raw =
              caught instanceof Error
                ? caught.message
                : 'BiRefNet auto-mask failed.'
            const message = formatBirefNetInitFailureMessage(raw)
            failures.push(`${image.name}: ${message}`)
            setProjects((previous) => {
              const current = previous[image.id] ?? createProjectFields()
              return {
                ...previous,
                [image.id]: {
                  ...current,
                  maskMeta: {
                    ...current.maskMeta,
                    // Do not set hasEdits — failed images must not inflate maskedCount.
                    needsReview: true,
                    autoFailed: true,
                    reviewReason: message,
                    diagnosticSummary: undefined,
                    processingPhase: 'failed',
                  },
                },
              }
            })
          }
        }

        const workers = Array.from(
          { length: Math.min(concurrency, queue.length) },
          async () => {
            while (nextIndex < queue.length) {
              if (!isCurrent()) return
              const index = nextIndex
              nextIndex += 1
              await runOne(queue[index]!, index + 1)
            }
          },
        )
        await Promise.all(workers)
        if (!isCurrent()) return

        const used = [...methodsSeen].join(', ') || 'birefnet-lite-512'
        if (failCount > 0) {
          setError(failures.slice(0, 3).join(' · '))
          setBatchProgress(
            `Auto-mask finished: ${successCount} ok, ${failCount} failed via ${used}` +
              (reviewFlagged > 0
                ? ` (${reviewFlagged} flagged for review).`
                : '.') +
              (failCount > 0 ? ' Use Retry failed for the rest.' : ''),
          )
        } else {
          setBatchProgress(
            reviewFlagged > 0
              ? `Auto-masked ${successCount} images via ${used} (${reviewFlagged} flagged for review).`
              : `Auto-masked ${successCount} images via ${used}.`,
          )
        }
      } catch (caught) {
        if (!isCurrent()) return
        const message =
          caught instanceof Error
            ? caught.message
            : 'Batch auto-mask failed.'
        setError(message)
        setBatchProgress(`Auto-mask stopped: ${message}`)
      } finally {
        if (isCurrent()) {
          autoMaskInFlightRef.current = false
          setBatchBusy(false)
        }
      }
    },
    [selectedId],
  )

  const handleExportZip = useCallback(
    async (scope: 'all' | 'masked') => {
      setBatchBusy(true)
      setError(null)
      try {
        const selected = images.filter((image) => {
          if (scope === 'all') {
            return true
          }
          const meta = projects[image.id]?.maskMeta
          return !!meta?.hasEdits && !meta.autoFailed
        })
        if (selected.length === 0) {
          setError('No images available for ZIP export.')
          return
        }

        const payload = selected.map((image) => {
          const project = projects[image.id] ?? createProjectFields()
          return {
            image,
            background: project.background,
            adjustments: project.adjustments,
            hasMaskEdits: project.maskMeta.hasEdits,
          }
        })

        const blob = await buildResultsZip(payload, zipFormat, (progress) => {
          setBatchProgress(
            `Zipping ${progress.current}/${progress.total}: ${progress.fileName}`,
          )
        })
        downloadBlob(blob, `garment-results-${scope}.zip`)
        setBatchProgress(`Downloaded ZIP with ${selected.length} files.`)
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'ZIP export failed.',
        )
      } finally {
        setBatchBusy(false)
      }
    },
    [images, projects, zipFormat],
  )

  const openMaskEditor = () => {
    if (!selectedImage) {
      return
    }
    ensureProject(selectedImage.id)
    setMode('mask')
  }

  const openAdjustStudio = () => {
    if (!selectedImage) {
      return
    }
    ensureProject(selectedImage.id)
    setMode('adjust')
  }

  const studioOpen = mode !== 'gallery'

  return (
    <div className={`app${studioOpen ? ' app--editing' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app__header">
        <h1>Garment Background Studio</h1>
        <p>
          Upload clothing photos, remove backgrounds on your device, add a
          shared background, and export a ZIP. Photos stay in the browser — no
          API key required.
        </p>
        <details className="app__steps-wrap">
          <summary className="app__steps-summary">How it works</summary>
          <ol className="app__steps" aria-label="Recommended workflow">
            <li>Upload product photos</li>
            <li>
              Tap <strong>Start Auto-mask all</strong> (or Edit Mask to refine)
            </li>
            <li>Set a background in Edit Mask (color or your own image)</li>
            <li>
              Batch → <strong>Apply background</strong>, then Adjust if needed
            </li>
            <li>Download ZIP</li>
          </ol>
        </details>
      </header>

      {mode === 'mask' && selectedImage ? (
        <main id="main-content" className="app__main">
          <MaskEditor
            image={selectedImage}
            background={
              selectedProject?.background ?? createDefaultBackground()
            }
            sharedBackgrounds={sharedBackgrounds}
            onBackgroundChange={handleBackgroundChange}
            onSharedBackgroundAdded={handleSharedBackgroundAdded}
            onMaskEdited={handleMaskEdited}
            onClose={() => setMode('gallery')}
          />
        </main>
      ) : null}

      {mode === 'adjust' && selectedImage ? (
        <main id="main-content" className="app__main">
          <AdjustStudio
            image={selectedImage}
            background={
              selectedProject?.background ?? createDefaultBackground()
            }
            adjustments={
              selectedProject?.adjustments ?? createDefaultAdjustments()
            }
            maskRevision={selectedProject?.maskMeta.revision ?? 0}
            hasMaskEdits={selectedProject?.maskMeta.hasEdits ?? false}
            onAdjustmentsChange={handleAdjustmentsChange}
            onClose={() => setMode('gallery')}
          />
        </main>
      ) : null}

      {mode === 'gallery' ? (
        <main id="main-content" className="app__main app__main--gallery">
          <section className="panel" aria-labelledby="upload-heading">
            <div className="panel__heading">
              <h2 id="upload-heading">Images</h2>
              {images.length > 0 ? (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={handleClear}
                  disabled={batchBusy}
                  data-testid="clear-all"
                >
                  Clear all
                </button>
              ) : null}
            </div>

            <ImageUploader
              onFilesSelected={handleFilesSelected}
              disabled={isLoading || batchBusy}
            />

            {error ? (
              <p className="app__error" role="alert" data-testid="upload-error">
                {error}
              </p>
            ) : null}

            {isLoading ? (
              <p className="app__status" data-testid="upload-status">
                Loading images…
              </p>
            ) : null}

            <ThumbnailGallery
              images={images}
              selectedId={selectedId}
              needsReviewById={needsReviewById}
              maskStatusById={maskStatusById}
              onSelect={(id) => {
                setSelectedId(id)
                ensureProject(id)
              }}
              onRemove={handleRemove}
            />
          </section>

          <section className="panel panel--preview" aria-labelledby="preview-heading">
            <div className="panel__heading">
              <h2 id="preview-heading">Preview</h2>
              <div className="panel__heading-actions">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={!selectedImage || batchBusy}
                  onClick={openMaskEditor}
                  data-testid="open-mask-editor"
                >
                  Edit Mask
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={!selectedImage || batchBusy}
                  onClick={openAdjustStudio}
                  data-testid="open-adjust-studio"
                >
                  Adjust &amp; Export
                </button>
              </div>
            </div>
            <CanvasPreview
              image={selectedImage}
              background={selectedProject?.background ?? null}
              adjustments={selectedProject?.adjustments ?? null}
              maskRevision={selectedProject?.maskMeta.revision ?? 0}
              showResult={!!selectedProject?.maskMeta.hasEdits}
            />
            {selectedImage &&
            selectedProject &&
            (selectedProject.maskMeta.needsReview ||
              peelUndoAvailable ||
              (selectedProject.maskMeta.diagnosticSummary?.findings.some(
                (f) => f.severity !== 'info',
              ) ??
                false)) ? (
              <ReviewDiagnosticsPanel
                imageId={selectedImage.id}
                imageName={selectedImage.name}
                objectUrl={selectedImage.objectUrl}
                width={selectedImage.width}
                height={selectedImage.height}
                methodUsed={selectedProject.maskMeta.autoMethodUsed}
                needsReview={!!selectedProject.maskMeta.needsReview}
                reviewReason={selectedProject.maskMeta.reviewReason}
                hasManualEdits={!!selectedProject.maskMeta.hasManualEdits}
                maskRevision={selectedProject.maskMeta.revision}
                summary={selectedProject.maskMeta.diagnosticSummary}
                onMaskRepaired={handleDiagnosticRepair}
                onPeelUndoAvailabilityChange={setPeelUndoAvailable}
              />
            ) : null}
            {selectedProject?.maskMeta.autoFailed ? (
              <p
                className="app__status app__status--review app__status--clamp"
                data-testid="mask-status"
                title={
                  selectedProject.maskMeta.reviewReason
                    ? `Auto-mask failed: ${selectedProject.maskMeta.reviewReason}`
                    : 'Auto-mask failed'
                }
              >
                Auto-mask failed
                {selectedProject.maskMeta.reviewReason
                  ? `: ${selectedProject.maskMeta.reviewReason}`
                  : '.'}{' '}
                Use Batch → Retry failed.
              </p>
            ) : selectedProject?.maskMeta.hasEdits ? (
              <p
                className={`app__status app__status--clamp${
                  selectedProject.maskMeta.needsReview
                    ? ' app__status--review'
                    : ''
                }`}
                data-testid="mask-status"
                title={[
                  'Mask saved',
                  selectedProject.maskMeta.autoMethodUsed
                    ? `method ${selectedProject.maskMeta.autoMethodUsed}`
                    : null,
                  selectedProject.maskMeta.needsReview
                    ? selectedProject.maskMeta.reviewReason ??
                      'review recommended'
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                Mask saved
                {selectedProject.maskMeta.autoMethodUsed
                  ? ` · ${selectedProject.maskMeta.autoMethodUsed}`
                  : ''}
                {selectedProject.maskMeta.hasManualEdits
                  ? ' · includes manual edits'
                  : ''}
                {selectedProject.background.type !== 'transparent'
                  ? ' · showing result with background'
                  : ''}
                {selectedProject.maskMeta.needsReview
                  ? selectedProject.maskMeta.reviewReason
                    ? ` · review: ${selectedProject.maskMeta.reviewReason}`
                    : ' · review recommended'
                  : ''}
                .
              </p>
            ) : (
              <p className="app__status">
                Tap <strong>Start Auto-mask all</strong> below, or open Edit Mask
                to refine one photo.
              </p>
            )}
      </section>

          <BatchPanel
            imageCount={images.length}
            maskedCount={maskedCount}
            pendingCount={pendingCount}
            runningCount={runningCount}
            reviewCount={reviewCount}
            failedCount={failedCount}
            busy={batchBusy}
            progress={batchProgress}
            exportFormat={zipFormat}
            onExportFormatChange={setZipFormat}
            onApplyBackgroundToAll={handleApplyBackgroundToAll}
            onApplyAdjustmentsToAll={handleApplyAdjustmentsToAll}
            onAutoMaskAll={() => void runLocalAutoMask('all')}
            onRetryFailed={() => void runLocalAutoMask('failed')}
            onRetrySelected={() => void runLocalAutoMask('selected')}
            onExportZip={(scope) => void handleExportZip(scope)}
            canApplyFromSelection={!!selectedImage}
            canRetrySelected={
              !!selectedImage &&
              (projects[selectedImage.id]?.maskMeta.autoFailed === true ||
                (!projects[selectedImage.id]?.maskMeta.hasEdits &&
                  !projects[selectedImage.id]?.maskMeta.hasManualEdits))
            }
          />
        </main>
      ) : null}
    </div>
  )
}

export default App
