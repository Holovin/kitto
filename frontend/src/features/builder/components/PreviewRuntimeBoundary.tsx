import type { ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { AlertTriangle, RefreshCcw, Trash2 } from 'lucide-react';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';

type PreviewRuntimeBoundaryProps = {
  children: ReactNode;
  onClear: () => void;
  resetKeys?: unknown[];
  clearLabel?: string;
};

type PreviewFallbackProps = FallbackProps & {
  onClear: () => void;
  clearLabel?: string;
};

function PreviewRuntimeFallback({ error, resetErrorBoundary, onClear, clearLabel = 'Clear builder' }: PreviewFallbackProps) {
  const message = error instanceof Error ? error.message : 'Unknown preview runtime error';

  function handleClear() {
    onClear();
    resetErrorBoundary();
  }

  return (
    <div className="flex min-h-[30rem] items-center justify-center">
      <Card className="w-full max-w-xl border-destructive/20 bg-card/95">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3 text-destructive">
            <AlertTriangle className="size-5" />
            <CardTitle className="text-xl">Preview crashed</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-[1.125rem] border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
            {message}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={resetErrorBoundary}>
              <RefreshCcw className="size-4" />
              Retry render
            </Button>
            <Button variant="destructive" onClick={handleClear}>
              <Trash2 className="size-4" />
              {clearLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function PreviewRuntimeBoundary({ children, onClear, resetKeys, clearLabel = 'Clear builder' }: PreviewRuntimeBoundaryProps) {
  return (
    <ErrorBoundary
      FallbackComponent={(props) => <PreviewRuntimeFallback {...props} onClear={onClear} clearLabel={clearLabel} />}
      resetKeys={resetKeys}
    >
      {children}
    </ErrorBoundary>
  );
}
