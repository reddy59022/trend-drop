import React from 'react';

/**
 * ErrorBoundary - Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing the whole app.
 * This is an enterprise-grade pattern for React applications.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // Log to external error reporting service in production
    if (process.env.NODE_ENV === 'production') {
      try {
        const errorPayload = {
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo?.componentStack,
          url: window.location.href,
          timestamp: new Date().toISOString(),
        };
        // Send to monitoring endpoint (non-blocking)
        fetch('/api/reports/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(errorPayload),
          keepalive: true,
        }).catch(() => {});
      } catch (e) {
        // Silently fail - we don't want error reporting to cause more errors
      }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const { error } = this.state;
      const isNetworkError = error?.message?.includes('Network') || error?.message?.includes('Failed to fetch');
      const isAuthError = error?.message?.includes('401') || error?.message?.includes('unauthorized');

      return (
        <div className="page-container" style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          minHeight: '60vh',
          textAlign: 'center',
          padding: '40px 20px'
        }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>
            {isNetworkError ? '🌐' : isAuthError ? '🔒' : '⚠️'}
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
            {isNetworkError ? 'Connection Issue' : isAuthError ? 'Access Error' : 'Something went wrong'}
          </h1>
          <p style={{ color: 'var(--td-text-secondary)', maxWidth: 400, marginBottom: 24, fontSize: 14, lineHeight: 1.5 }}>
            {isNetworkError 
              ? 'Unable to connect to our servers. Please check your internet connection and try again.'
              : isAuthError
                ? 'Your session may have expired. Please sign in again.'
                : 'An unexpected error occurred. Our team has been notified and we\'re working on a fix.'}
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-primary" onClick={this.handleReload}>
              Reload Page
            </button>
            <button className="btn btn-outline" onClick={() => window.location.href = '/'}>
              Go Home
            </button>
          </div>
          {process.env.NODE_ENV !== 'production' && error && (
            <details style={{ marginTop: 24, textAlign: 'left', maxWidth: 600 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--td-text-tertiary)' }}>
                Error Details (Development Only)
              </summary>
              <pre style={{ 
                marginTop: 8, 
                padding: 12, 
                background: '#fef2f2', 
                borderRadius: 8,
                fontSize: 11,
                overflow: 'auto',
                maxHeight: 300,
                border: '1px solid #fecaca'
              }}>
                {error?.stack || error?.message || 'No error details available'}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;