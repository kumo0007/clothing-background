import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BatchPanel } from './BatchPanel'

afterEach(() => cleanup())

describe('BatchPanel — local auto-mask UI', () => {
  it('describes BiRefNet-only processing without a model selector', () => {
    render(
      <BatchPanel
        imageCount={2}
        maskedCount={0}
        pendingCount={2}
        busy={false}
        progress={null}
        exportFormat="png"
        onExportFormatChange={() => undefined}
        onApplyBackgroundToAll={() => undefined}
        onApplyAdjustmentsToAll={() => undefined}
        onAutoMaskAll={() => undefined}
        onRetryFailed={() => undefined}
        onRetrySelected={() => undefined}
        onExportZip={() => undefined}
        canApplyFromSelection
        canRetrySelected={false}
      />,
    )

    expect(screen.getByTestId('batch-panel')).toBeInTheDocument()
    expect(screen.getByTestId('batch-auto-mask')).toBeInTheDocument()
    expect(
      screen.queryByTestId('batch-auto-mask-strategy'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/ISNet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/contour-first/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/GrabCut/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Poof/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/RMBG/i)).not.toBeInTheDocument()
    expect(screen.getByText(/on this device/i)).toBeInTheDocument()
    expect(screen.getByTestId('batch-auto-mask-backend')).toHaveTextContent(
      /BiRefNet/i,
    )
    expect(screen.getByTestId('batch-auto-mask-backend').tagName).not.toBe(
      'SELECT',
    )
    expect(screen.getByTestId('batch-start-cta')).toBeInTheDocument()
    expect(screen.getByTestId('batch-pending-count')).toHaveTextContent(
      /2.*pending/,
    )
    expect(screen.getAllByTestId('batch-auto-mask')).toHaveLength(1)
    expect(screen.queryByText(/Masking model/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Tips for iPhone/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Masking model/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('batch-progress')).toBeNull()
  })

  it('keeps background, export, and auto-mask actions', async () => {
    const user = userEvent.setup()
    const onAutoMaskAll = vi.fn()
    const onRetryFailed = vi.fn()
    const onExportZip = vi.fn()
    const onApplyBackgroundToAll = vi.fn()

    render(
      <BatchPanel
        imageCount={3}
        maskedCount={1}
        reviewCount={1}
        failedCount={2}
        busy={false}
        progress={null}
        exportFormat="png"
        onExportFormatChange={() => undefined}
        onApplyBackgroundToAll={onApplyBackgroundToAll}
        onApplyAdjustmentsToAll={() => undefined}
        onAutoMaskAll={onAutoMaskAll}
        onRetryFailed={onRetryFailed}
        onRetrySelected={() => undefined}
        onExportZip={onExportZip}
        canApplyFromSelection
        canRetrySelected
      />,
    )

    expect(screen.getByTestId('batch-review-count')).toHaveTextContent(
      /1.*review/,
    )
    expect(screen.getByTestId('batch-failed-count')).toHaveTextContent(
      /2.*failed/,
    )
    await user.click(screen.getByTestId('batch-auto-mask'))
    expect(onAutoMaskAll).toHaveBeenCalledOnce()
    await user.click(screen.getByTestId('batch-retry-failed'))
    expect(onRetryFailed).toHaveBeenCalledOnce()
    await user.click(screen.getByTestId('batch-apply-bg'))
    expect(onApplyBackgroundToAll).toHaveBeenCalledOnce()
    await user.click(screen.getByTestId('batch-export-all'))
    expect(onExportZip).toHaveBeenCalledWith('all')
  })
})
