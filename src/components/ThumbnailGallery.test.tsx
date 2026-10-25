import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThumbnailGallery } from './ThumbnailGallery'
import type { UploadedImage } from '../types'

afterEach(() => cleanup())

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

  it('shows Pending for unmasked thumbs without starting inference', () => {
    render(
      <ThumbnailGallery
        images={images}
        selectedId="img-ok"
        maskStatusById={{
          'img-ok': 'pending',
          'img-review': 'pending',
        }}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.getByTestId('thumb-pending-img-ok')).toHaveTextContent(
      'Pending',
    )
    expect(screen.getByLabelText('Select ok.jpg (pending)')).toBeInTheDocument()
  })
})
