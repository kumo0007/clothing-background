import type { ImageAdjustments } from '../../types/adjustments'
import {
  shouldCompositeResult,
  type BackgroundState,
} from '../../types/background'
import type { UploadedImage } from '../../types'
import { loadHtmlImage } from '../image/loadHtmlImage'
import { isUsableKeepMask } from '../mask/maskKeepRatio'
import { getMask } from '../mask/maskStore'
import { renderFinal } from '../rendering/renderFinal'

export type ProjectRenderInput = {
  image: UploadedImage
  background: BackgroundState
  adjustments: ImageAdjustments
  hasMaskEdits: boolean
}

export async function renderProjectCanvas(
  input: ProjectRenderInput,
): Promise<HTMLCanvasElement> {
  const original = await loadHtmlImage(input.image.objectUrl)
  let backgroundImage: HTMLImageElement | null = null
  if (input.background.type === 'image' && input.background.imageUrl) {
    backgroundImage = await loadHtmlImage(input.background.imageUrl)
  }

  const mask = getMask(input.image.id)
  const useComposite =
    shouldCompositeResult(
      input.hasMaskEdits,
      mask !== undefined,
      input.background,
      input.adjustments.shadowOpacity,
    ) &&
    !!mask &&
    isUsableKeepMask(mask)

  return renderFinal({
    original,
    width: input.image.width,
    height: input.image.height,
    mask: mask ?? null,
    background: input.background,
    backgroundImage,
    adjustments: input.adjustments,
    useComposite,
  })
}
