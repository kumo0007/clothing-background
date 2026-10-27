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
 * When a KEEP mask exists, always composite — including transparent backgrounds
 * (cutout on checkerboard / PNG alpha). Shadow-only used to force this for
 * transparent; that is now the default so gallery preview matches export.
 */
export function shouldCompositeResult(
  hasMaskEdits: boolean,
  hasMask: boolean,
  _background: BackgroundState,
  _shadowOpacity: number,
): boolean {
  return hasMaskEdits && hasMask
}
