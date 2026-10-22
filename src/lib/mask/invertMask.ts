import type { MaskPixelBuffer } from '../../types/mask'

/** Invert every mask value: newValue = 255 - oldValue. */
export function invertMaskBuffer(mask: MaskPixelBuffer): void {
  const { data } = mask
  for (let i = 0; i < data.length; i += 1) {
    data[i] = 255 - data[i]
  }
}
