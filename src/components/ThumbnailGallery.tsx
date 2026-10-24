import type { UploadedImage } from '../types'

type ThumbnailGalleryProps = {
  images: UploadedImage[]
  selectedId: string | null
  /** Per-image auto-mask review flags (supervised QC). */
  needsReviewById?: Record<string, boolean>
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

export function ThumbnailGallery({
  images,
  selectedId,
  needsReviewById,
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
        const needsReview = needsReviewById?.[image.id] === true
        return (
          <li key={image.id} className="gallery__item">
            <button
              type="button"
              className={`gallery__thumb${
                isSelected ? ' gallery__thumb--selected' : ''
              }${needsReview ? ' gallery__thumb--review' : ''}`}
              onClick={() => onSelect(image.id)}
              aria-pressed={isSelected}
              aria-label={
                needsReview
                  ? `Select ${image.name} (needs review)`
                  : `Select ${image.name}`
              }
              data-testid={`thumb-${image.id}`}
            >
              <span className="gallery__thumb-frame">
                <img src={image.objectUrl} alt="" />
                {needsReview ? (
                  <span
                    className="gallery__review-badge"
                    data-testid={`thumb-review-${image.id}`}
                  >
                    Review
                  </span>
                ) : null}
              </span>
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
