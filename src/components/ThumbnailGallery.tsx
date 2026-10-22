import type { UploadedImage } from '../types'

type ThumbnailGalleryProps = {
  images: UploadedImage[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

export function ThumbnailGallery({
  images,
  selectedId,
  onSelect,
  onRemove,
}: ThumbnailGalleryProps) {
  if (images.length === 0) {
    return (
      <p className="gallery-empty" data-testid="gallery-empty">
        No images uploaded yet.
      </p>
    )
  }

  return (
    <ul className="gallery" data-testid="thumbnail-gallery" role="list">
      {images.map((image) => {
        const isSelected = image.id === selectedId
        return (
          <li key={image.id} className="gallery__item">
            <button
              type="button"
              className={`gallery__thumb${
                isSelected ? ' gallery__thumb--selected' : ''
              }`}
              onClick={() => onSelect(image.id)}
              aria-pressed={isSelected}
              aria-label={`Select ${image.name}`}
              data-testid={`thumb-${image.id}`}
            >
              <img src={image.objectUrl} alt="" />
              <span className="gallery__name">{image.name}</span>
            </button>
            <button
              type="button"
              className="gallery__remove"
              onClick={() => onRemove(image.id)}
              aria-label={`Remove ${image.name}`}
              data-testid={`remove-${image.id}`}
            >
              Remove
            </button>
          </li>
        )
      })}
    </ul>
  )
}
