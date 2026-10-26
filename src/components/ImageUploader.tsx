import { useCallback, useId, useRef, useState, type DragEvent } from 'react'
import { IMAGE_FILE_ACCEPT } from '../utils/imageFiles'

type ImageUploaderProps = {
  onFilesSelected: (files: File[]) => void
  disabled?: boolean
}

export function ImageUploader({
  onFilesSelected,
  disabled = false,
}: ImageUploaderProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) {
        return
      }
      onFilesSelected(Array.from(fileList))
      if (inputRef.current) {
        inputRef.current.value = ''
      }
    },
    [onFilesSelected],
  )

  const openPicker = useCallback(() => {
    if (disabled) return
    // Explicit .click() is more reliable on iOS Safari than label+opacity:0 alone.
    inputRef.current?.click()
  }, [disabled])

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!disabled) {
      setIsDragging(true)
    }
  }

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (disabled) {
      return
    }
    handleFiles(event.dataTransfer.files)
  }

  return (
    <div
      className={`uploader${isDragging ? ' uploader--dragging' : ''}${
        disabled ? ' uploader--disabled' : ''
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-testid="image-uploader"
    >
      {/*
        Nest input inside label (Safari-friendly). Keep a visible Choose button
        that calls input.click() — opacity:0 overlays alone often fail on iOS.
      */}
      <label className="uploader__label" htmlFor={inputId}>
        <span className="uploader__title">Upload garment images</span>
        <span className="uploader__hint">
          Tap <strong>Choose photos</strong> to open the iPhone library, or
          drag and drop. JPEG, PNG, WebP, GIF, and BMP work everywhere. Safari
          can often decode HEIC; if it fails, export as JPEG (Most Compatible).
          Upload does not start masking — use Batch → Auto-mask all.
        </span>
        <span className="uploader__actions">
          <button
            type="button"
            className="button button--primary uploader__choose"
            disabled={disabled}
            data-testid="image-upload-choose"
            onClick={(event) => {
              // Prevent the label from also forwarding a second click.
              event.preventDefault()
              event.stopPropagation()
              openPicker()
            }}
          >
            Choose photos
          </button>
        </span>
        <input
          ref={inputRef}
          id={inputId}
          className="uploader__input"
          type="file"
          accept={IMAGE_FILE_ACCEPT}
          multiple
          disabled={disabled}
          onChange={(event) => handleFiles(event.target.files)}
          data-testid="image-file-input"
        />
      </label>
    </div>
  )
}
