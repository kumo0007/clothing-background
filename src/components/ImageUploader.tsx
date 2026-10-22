import { useCallback, useId, useRef, useState, type DragEvent } from 'react'

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
          Drag and drop multiple images, or click to browse. JPEG, PNG, WebP,
          GIF, and BMP are supported.
        </span>
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className="uploader__input"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
        multiple
        disabled={disabled}
        onChange={(event) => handleFiles(event.target.files)}
        data-testid="image-file-input"
      />
    </div>
  )
}
