import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AppButton } from '../src/ui/components/AppButton';

interface ErrorBoundaryProps {
  children: ReactNode;
  section?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('Unhandled render error:', error, info.componentStack);
    }
  }

  private handleReload = () => {
    if (this.props.section) this.setState({ hasError: false, error: null });
    else window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div role="alert" className={`${this.props.section ? 'min-h-64' : 'min-h-screen'} flex items-center justify-center p-6`}>
        <div className="max-w-md w-full rounded-lg border border-gray-500/30 p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle className="h-6 w-6 text-red-400" />
          </div>
          <h1 className="mb-2 text-lg font-semibold">Something went wrong</h1>
          <p className="mb-5 text-sm text-gray-400">
            {this.props.section
              ? 'This section could not be displayed. You can retry or choose another section. Retrying does not repeat server commands.'
              : 'The interface hit an unexpected error. Reload the page. If the problem persists, contact your administrator.'}
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mb-5 max-h-40 overflow-auto rounded bg-black/40 p-3 text-left text-xs text-red-300">
              {this.state.error.message}
            </pre>
          )}
          <AppButton tone="primary" onClick={this.handleReload}>
            {this.props.section ? 'Retry section' : 'Reload the page'}
          </AppButton>
        </div>
      </div>
    );
  }
}
