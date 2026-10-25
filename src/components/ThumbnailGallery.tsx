import type { UploadedImage } from '../types'

export type ThumbMaskStatus = 'pending' | 'processing' | 'failed' | 'review'

type ThumbnailGalleryProps = {
  images: UploadedImage[]
  selectedId: string | null
  /** Per-image auto-mask review flags (supervised QC). */
  needsReviewById?: Record<string, boolean>
  /** Explicit per-thumb status for pending / processing / failed. */
  maskStatusById?: Record<string, ThumbMaskStatus>
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

function badgeForStatus(
  status: ThumbMaskStatus | undefined,
  needsReview: boolean,
): { label: string; testIdSuffix: string } | null {
  if (status === 'processing') {
    return { label: 'Working', testIdSuffix: 'processing' }
  }
  if (status === 'failed') {
    return { label: 'Failed', testIdSuffix: 'failed' }
  }
  if (needsReview || status === 'review') {
    return { label: 'Review', testIdSuffix: 'review' }
  }
  if (status === 'pending') {
    return { label: 'Pending', testIdSuffix: 'pending' }
  }
  return null
}

export function ThumbnailGallery({
  images,
  selectedId,
  needsReviewById,
  maskStatusById,
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
        const status = maskStatusById?.[image.id]
        const badge = badgeForStatus(status, needsReview)
        const statusLabel =
          status === 'processing'
            ? 'processing'
            : status === 'failed'
              ? 'failed'
              : needsReview
                ? 'needs review'
                : status === 'pending'
                  ? 'pending'
                  : null

        return (
          <li key={image.id} className="gallery__item">
            <button
              type="button"
              className={`gallery__thumb${
                isSelected ? ' gallery__thumb--selected' : ''
              }${needsReview || status === 'failed' ? ' gallery__thumb--review' : ''}${
                status === 'pending' ? ' gallery__thumb--pending' : ''
              }`}
              onClick={() => onSelect(image.id)}
              aria-pressed={isSelected}
              aria-label={
                statusLabel
                  ? `Select ${image.name} (${statusLabel})`
                  : `Select ${image.name}`
              }
              data-testid={`thumb-${image.id}`}
            >
              <span className="gallery__thumb-frame">
                <img src={image.objectUrl} alt="" />
                {badge ? (
                  <span
                    className={`gallery__review-badge gallery__review-badge--${badge.testIdSuffix}`}
                    data-testid={`thumb-${badge.testIdSuffix}-${image.id}`}
                  >
                    {badge.label}
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
