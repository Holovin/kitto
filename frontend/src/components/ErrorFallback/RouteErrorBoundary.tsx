import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card';
import { resetAppStateAndReload } from '@store/errorRecovery';

function getRouteErrorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown route error.';
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const message = getRouteErrorMessage(error);

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4 py-10" role="alert">
      <Card className="w-full max-w-xl border-white/70 bg-white/92">
        <CardHeader className="space-y-3">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Route error</p>
          <CardTitle className="text-3xl">This screen failed to render.</CardTitle>
          <CardDescription className="text-base leading-7">{message}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => window.location.reload()}>
            Reload page
          </Button>
          <Button type="button" variant="secondary" onClick={resetAppStateAndReload}>
            Reset builder state
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
