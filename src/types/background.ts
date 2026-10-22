export type BackgroundType = 'color' | 'image' | 'transparent'

export type BackgroundFitMode = 'contain' | 'cover' | 'stretch'

export type BackgroundState = {
  type: BackgroundType
  /** Hex color used when type is "color". */
  color: string
  /** Object URL of a shared/local background image when type is "image". */
  imageUrl: string | null
  /** Display name for the chosen background image. */
  imageName: string | null
  fitMode: BackgroundFitMode
}

export type SharedBackgroundImage = {
  id: string
  objectUrl: string
  name: string
}

export function createDefaultBackground(): BackgroundState {
  return {
    type: 'transparent',
    color: '#F5F5F5',
    imageUrl: null,
    imageName: null,
    fitMode: 'cover',
  }
}

/**
 * Whether the final pipeline should composite mask × background.
 * Transparent backgrounds normally show the original; enable compositing when
 * a product shadow is active so the silhouette (and shadow) can render.
 */
export function shouldCompositeResult(
  hasMaskEdits: boolean,
  hasMask: boolean,
  background: BackgroundState,
  shadowOpacity: number,
): boolean {
  if (!hasMaskEdits || !hasMask) {
    return false
  }
  if (background.type !== 'transparent') {
    return true
  }
  return shadowOpacity > 0
}
