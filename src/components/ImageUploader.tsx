import { useCallback, useId, useRef, useState, type DragEvent } from 'react'
import { IMAGE_FILE_ACCEPT } from '../utils/imageFiles'

type ImageUploaderProps = {
  onFilesSelected: (files: File[]) => void
  disabled?: boolean
}

/**
 * iPhone Safari: do not use opacity overlays or programmatic input.click().
 * Style the native `::file-selector-button` — that control opens Photos.
 */
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
      <div className="uploader__copy">
        <p className="uploader__title" id={`${inputId}-title`}>
          Upload garment images
        </p>
        <p className="uploader__hint" id={`${inputId}-hint`}>
          Tap the green <strong>Choose File</strong> / Browse button below
          (native iPhone control). JPEG, PNG, WebP, GIF, BMP — Safari often
          accepts HEIC too; if not, export JPEG (Most Compatible). Upload does
          not start masking — use Batch → Auto-mask all.
        </p>
      </div>

      <div className="uploader__actions">
        <input
          ref={inputRef}
          id={inputId}
          className="uploader__native-file"
          type="file"
          accept={IMAGE_FILE_ACCEPT}
          multiple
          disabled={disabled}
          onChange={(event) => handleFiles(event.target.files)}
          data-testid="image-file-input"
          aria-labelledby={`${inputId}-title`}
          aria-describedby={`${inputId}-hint`}
        />
      </div>
    </div>
  )
}
