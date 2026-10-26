import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppErrorBoundary } from './AppErrorBoundary'

afterEach(() => {
  cleanup()
})

function Boom(): null {
  throw new Error('simulated render failure')
}

describe('AppErrorBoundary', () => {
  it('shows a visible recovery UI instead of a blank root', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )

    expect(screen.getByTestId('app-error-boundary')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/Something went wrong/i)
    expect(screen.getByText(/simulated render failure/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reload page/i })).toBeInTheDocument()

    // Reset path clears the boundary state (child will throw again → still visible).
    await user.click(
      screen.getByRole('button', { name: /Try recover without reload/i }),
    )
    expect(screen.getByTestId('app-error-boundary')).toBeInTheDocument()

    spy.mockRestore()
  })

  it('renders children when there is no error', () => {
    render(
      <AppErrorBoundary>
        <div data-testid="ok-child">studio ui</div>
      </AppErrorBoundary>,
    )
    expect(screen.getByTestId('ok-child')).toHaveTextContent('studio ui')
    expect(screen.queryByTestId('app-error-boundary')).not.toBeInTheDocument()
  })
})
