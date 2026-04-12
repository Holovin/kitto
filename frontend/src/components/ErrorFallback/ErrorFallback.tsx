import type { FallbackProps } from 'react-error-boundary';
import './ErrorFallback.css';

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : 'Unknown runtime error';

  return (
    <main className="error-fallback" role="alert">
      <section className="error-fallback__card">
        <p className="error-fallback__eyebrow">Application Error</p>
        <h1 className="error-fallback__title">Something broke.</h1>
        <p className="error-fallback__message">{message}</p>
        <button className="error-fallback__button" type="button" onClick={resetErrorBoundary}>
          Try Again
        </button>
      </section>
    </main>
  );
}
