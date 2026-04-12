import type { FallbackProps } from 'react-error-boundary';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card';
import { resetAppStateAndReload } from '@store/errorRecovery';

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : 'Unknown runtime error';

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10" role="alert">
      <Card className="w-full max-w-lg border-white/70 bg-white/92">
        <CardHeader className="space-y-3">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Application error</p>
          <CardTitle className="text-3xl">Something broke.</CardTitle>
          <CardDescription className="text-base leading-7">{message}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button type="button" onClick={resetErrorBoundary}>
            Try again
          </Button>
          <Button type="button" variant="secondary" onClick={resetAppStateAndReload}>
            Reset builder state
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
