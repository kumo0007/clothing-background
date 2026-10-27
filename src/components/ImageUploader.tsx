import {
  useCallback,
  useId,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { IMAGE_FILE_ACCEPT } from '../utils/imageFiles'

type ImageUploaderProps = {
  onFilesSelected: (files: File[]) => void
  disabled?: boolean
}

/**
 * File picker must be a visible native `<input type="file">` for iPhone Safari.
 * Drag-and-drop is also supported on desktop.
 */
export function ImageUploader({
  onFilesSelected,
  disabled = false,
}: ImageUploaderProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [pickerNote, setPickerNote] = useState<string | null>(null)

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) {
        setPickerNote(
          'No photos came back from the picker. Try again, or pick JPEG/PNG.',
        )
        return
      }
      setPickerNote(null)
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
          Tap <strong>Choose Files</strong> to open Photos or Files. Prefer
          JPEG/PNG/WebP. Upload alone does not mask — use Batch when ready.
        </p>
      </div>

      <div className="uploader__actions">
        <input
          ref={inputRef}
          id={inputId}
          className="uploader__file"
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

      {pickerNote ? (
        <p
          className="uploader__picker-note"
          role="status"
          data-testid="upload-picker-note"
        >
          {pickerNote}
        </p>
      ) : null}
    </div>
  )
}
