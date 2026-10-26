import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

/**
 * Prevents a render-time exception from leaving `#root` empty (blank page).
 * Does not catch async worker/model failures — those surface in Batch UI.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('[AppErrorBoundary]', error.message, info.componentStack)
    }
  }

  private handleReload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  private handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    const message = error.message || 'Unknown render error'
    return (
      <div
        className="app-boot-error"
        role="alert"
        data-testid="app-error-boundary"
      >
        <h1>Something went wrong</h1>
        <p>
          The studio UI failed to render. Your images were not uploaded to any
          server. Try reloading. If this keeps happening, try another browser
          (current Chrome, Edge, Firefox, or Safari) or disable extensions.
        </p>
        <pre className="app-boot-error__detail">{message}</pre>
        <div className="app-boot-error__actions">
          <button type="button" onClick={this.handleReload}>
            Reload page
          </button>
          <button type="button" onClick={this.handleReset}>
            Try recover without reload
          </button>
        </div>
      </div>
    )
  }
}
