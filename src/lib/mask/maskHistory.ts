import { cloneMaskBuffer } from './createMask'
import type { MaskPixelBuffer } from '../../types/mask'

/** Keep history modest — full-resolution masks (e.g. 1000×1200) are large. */
const DEFAULT_LIMIT = 24

export class MaskHistory {
  private undoStack: MaskPixelBuffer[] = []
  private redoStack: MaskPixelBuffer[] = []
  private readonly limit: number

  constructor(limit: number = DEFAULT_LIMIT) {
    this.limit = limit
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Push current mask state before applying a new edit. */
  push(current: MaskPixelBuffer): void {
    this.undoStack.push(cloneMaskBuffer(current))
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift()
    }
    this.redoStack = []
  }

  undo(current: MaskPixelBuffer): MaskPixelBuffer | null {
    const previous = this.undoStack.pop()
    if (!previous) {
      return null
    }
    this.redoStack.push(cloneMaskBuffer(current))
    return previous
  }

  redo(current: MaskPixelBuffer): MaskPixelBuffer | null {
    const next = this.redoStack.pop()
    if (!next) {
      return null
    }
    this.undoStack.push(cloneMaskBuffer(current))
    return next
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
