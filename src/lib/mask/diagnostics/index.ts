export type {
  AffectedRegion,
  DiagnosticFinding,
  DiagnosticOverlayKind,
  DiagnosticRuleId,
  DiagnosticSeverity,
  MaskDiagnostics,
  MaskMetricSnapshot,
} from './types'
export {
  borderBandWidth,
  computeMaskMetrics,
  countKeepComponents,
  internalHoleRatio,
  sampleBorderStudioIndices,
} from './maskMetrics'
export {
  analyzeKeepComponents,
  shouldFlagFragmentation,
  type FragmentationAnalysis,
  type FragmentationSummary,
  type KeepComponent,
} from './fragmentation'
export {
  buildDiagnosticOverlay,
  evaluateDiagnosticRules,
  runMaskDiagnostics,
} from './runMaskDiagnostics'
export {
  applyBorderStudioPeel,
  diagnosticsAfterPeel,
  previewBorderStudioPeel,
  type BorderPeelPreview,
} from './borderStudioRepair'
