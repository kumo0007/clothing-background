import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdjustStudio } from './components/AdjustStudio'
import { BatchPanel } from './components/BatchPanel'
import { CanvasPreview } from './components/CanvasPreview'
import { ImageUploader } from './components/ImageUploader'
import { MaskEditor } from './components/MaskEditor'
import { ThumbnailGallery } from './components/ThumbnailGallery'
import { autoMaskCornersForImage } from './lib/batch/autoMaskCorners'
import { buildResultsZip, downloadBlob } from './lib/batch/exportZip'
import type { ExportFormat } from './lib/export/exportImage'
import { clearAllMasks, deleteMask } from './lib/mask/maskStore'
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
  filterImageFiles,
  loadImageDimensions,
} from './utils/imageFiles'
import './App.css'

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
  const imagesRef = useRef(images)
  imagesRef.current = images
  const sharedBackgroundsRef = useRef(sharedBackgrounds)
  sharedBackgroundsRef.current = sharedBackgrounds

  const selectedImage = useMemo(
    () => images.find((image) => image.id === selectedId) ?? null,
    [images, selectedId],
  )

  const selectedProject = selectedId ? projects[selectedId] : undefined

  const maskedCount = useMemo(
    () =>
      images.reduce((count, image) => {
        const project = projects[image.id]
        return project?.maskMeta.hasEdits ? count + 1 : count
      }, 0),
    [images, projects],
  )

  useEffect(() => {
    return () => {
      for (const image of imagesRef.current) {
        URL.revokeObjectURL(image.objectUrl)
      }
      for (const asset of sharedBackgroundsRef.current) {
        URL.revokeObjectURL(asset.objectUrl)
      }
      clearAllMasks()
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
    const accepted = filterImageFiles(files)
    if (accepted.length === 0) {
      setError('No supported image files were selected.')
      return
    }

    setIsLoading(true)
    try {
      const loaded: UploadedImage[] = []
      for (const file of accepted) {
        const objectUrl = URL.createObjectURL(file)
        try {
          const { width, height } = await loadImageDimensions(objectUrl)
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
          setError(`Could not load "${file.name}".`)
        }
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
        revision: current.maskMeta.revision + 1,
        hasEdits: true,
      },
    }))
  }, [updateSelectedProject])

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

  const handleAutoMaskAll = useCallback(async () => {
    setBatchBusy(true)
    setError(null)
    try {
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index]
        setBatchProgress(
          `Auto-masking ${index + 1}/${images.length}: ${image.name}`,
        )
        await autoMaskCornersForImage(
          image.id,
          image.objectUrl,
          image.width,
          image.height,
        )
      }
      setProjects((previous) => {
        const next = { ...previous }
        for (const image of images) {
          const current = next[image.id] ?? createProjectFields()
          next[image.id] = {
            ...current,
            maskMeta: {
              revision: current.maskMeta.revision + 1,
              hasEdits: true,
            },
          }
        }
        return next
      })
      setBatchProgress(`Auto-masked ${images.length} images.`)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Batch auto-mask failed.',
      )
    } finally {
      setBatchBusy(false)
    }
  }, [images])

  const handleExportZip = useCallback(
    async (scope: 'all' | 'masked') => {
      setBatchBusy(true)
      setError(null)
      try {
        const selected = images.filter((image) => {
          if (scope === 'all') {
            return true
          }
          return projects[image.id]?.maskMeta.hasEdits
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
      <header className="app__header">
        <h1>Garment Background Studio</h1>
        <p>
          Upload clothing photos, swap in one shared background, and export a
          ZIP — entirely in your browser. No AI, no server, no subscriptions.
          Garment pixels (shape, color, pattern, logos) stay untouched.
        </p>
        <ol className="app__steps" aria-label="Recommended workflow">
          <li>Upload one or more product photos</li>
          <li>
            Batch → <strong>Auto-mask all</strong> (or Edit Mask to refine edges)
          </li>
          <li>
            In Edit Mask, set your background (color or upload your own image)
          </li>
          <li>
            Batch → <strong>Apply background to all</strong>, then Adjust for
            crop / frame / rotate / skew / color
          </li>
          <li>Batch → Download ZIP</li>
        </ol>
      </header>

      {mode === 'mask' && selectedImage ? (
        <main className="app__main">
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
        <main className="app__main">
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
        <main className="app__main app__main--gallery">
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
              onSelect={(id) => {
                setSelectedId(id)
                ensureProject(id)
              }}
              onRemove={handleRemove}
            />
          </section>

          <section className="panel" aria-labelledby="preview-heading">
            <div className="panel__heading">
              <h2 id="preview-heading">Canvas preview</h2>
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
              showResult={
                !!selectedProject &&
                selectedProject.background.type !== 'transparent' &&
                selectedProject.maskMeta.hasEdits
              }
            />
            {selectedProject?.maskMeta.hasEdits ? (
              <p className="app__status">
                Mask saved for this image
                {selectedProject.background.type !== 'transparent'
                  ? ' · showing composited result'
                  : ''}
                .
              </p>
            ) : (
              <p className="app__status">
                Mask individually, or use Batch → Auto-mask all for flat product
                shots.
              </p>
            )}
          </section>

          <BatchPanel
            imageCount={images.length}
            maskedCount={maskedCount}
            busy={batchBusy}
            progress={batchProgress}
            exportFormat={zipFormat}
            onExportFormatChange={setZipFormat}
            onApplyBackgroundToAll={handleApplyBackgroundToAll}
            onApplyAdjustmentsToAll={handleApplyAdjustmentsToAll}
            onAutoMaskAll={() => void handleAutoMaskAll()}
            onExportZip={(scope) => void handleExportZip(scope)}
            canApplyFromSelection={!!selectedImage}
          />
        </main>
      ) : null}
    </div>
  )
}

export default App
