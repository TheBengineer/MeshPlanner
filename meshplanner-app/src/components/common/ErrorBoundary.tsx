import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Catches rendering errors in the compute pipeline / child component tree
 * and displays a user-friendly fallback instead of a blank white screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: '16px',
            margin: '8px',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: '6px',
            color: '#991b1b',
            fontSize: '13px',
          }}
        >
          <p style={{ fontWeight: 600, margin: '0 0 6px' }}>
            Something went wrong
          </p>
          <p style={{ margin: '0 0 8px', color: '#7f1d1d' }}>
            {this.state.error?.message ?? 'An unexpected error occurred in the UI.'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            aria-label="Retry after error"
            style={{
              padding: '6px 14px',
              background: '#991b1b',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
            }}
          >
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Boundary ID for the compute pipeline portion of the sidebar.
 * Wraps ComputePanel + ExportPanel so a rendering crash there
 * doesn't take down the map or site list.
 */
export const COMPUTE_BOUNDARY_ID = 'compute-pipeline-boundary'
