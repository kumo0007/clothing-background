import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThumbnailGallery } from './ThumbnailGallery'
import type { UploadedImage } from '../types'

const images: UploadedImage[] = [
  {
    id: 'img-ok',
    name: 'ok.jpg',
    objectUrl: 'blob:ok',
    width: 10,
    height: 10,
    file: new File([], 'ok.jpg'),
  },
  {
    id: 'img-review',
    name: 'coat.jpg',
    objectUrl: 'blob:coat',
    width: 10,
    height: 10,
    file: new File([], 'coat.jpg'),
  },
]

describe('ThumbnailGallery review badges', () => {
  it('marks thumbs that need supervised QC', () => {
    render(
      <ThumbnailGallery
        images={images}
        selectedId="img-ok"
        needsReviewById={{ 'img-review': true }}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.getByTestId('thumb-review-img-review')).toHaveTextContent(
      'Review',
    )
    expect(screen.queryByTestId('thumb-review-img-ok')).not.toBeInTheDocument()
    expect(screen.getByTestId('thumb-img-review')).toHaveAttribute(
      'aria-label',
      'Select coat.jpg (needs review)',
    )
  })
})
