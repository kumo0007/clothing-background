import { useCallback, useId, useRef, useState, type DragEvent } from 'react'
import { IMAGE_FILE_ACCEPT } from '../utils/imageFiles'

type ImageUploaderProps = {
  onFilesSelected: (files: File[]) => void
  disabled?: boolean
}

/**
 * iPhone Safari file-picker notes:
 * - Programmatic `input.click()` is ignored when the input is `display:none`,
 *   `visibility:hidden`, zero-sized, or `clip`ped.
 * - A near-opaque (`opacity: 0.01`) full-bleed input on top of a `<label>`
 *   receives the real user tap and opens Photos reliably.
 * - Nesting a real `<button>` inside the label + `preventDefault` breaks that.
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
      <label className="uploader__label" htmlFor={inputId}>
        <span className="uploader__title">Upload garment images</span>
        <span className="uploader__hint">
          Tap the green <strong>Choose photos</strong> control (or anywhere in
          this box) to open Photos / Files. JPEG, PNG, WebP, GIF, BMP — Safari
          often accepts HEIC too; if not, export JPEG (Most Compatible). Upload
          does not start masking — use Batch → Auto-mask all.
        </span>
        <span className="uploader__actions">
          {/*
            Visual CTA only — pointer-events:none so the tap hits the file
            input layered above. Do not use <button> here (blocks iOS picker).
          */}
          <span
            className="button button--primary uploader__choose"
            data-testid="image-upload-choose"
            aria-hidden="true"
          >
            Choose photos
          </span>
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
          // Help VoiceOver / TalkBack name the control.
          aria-label="Choose photos to upload"
        />
      </label>
    </div>
  )
}
