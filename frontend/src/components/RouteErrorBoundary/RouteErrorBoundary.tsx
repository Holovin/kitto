import { useMemo } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { SiteRoutes } from '@router/siteRoutes';

function getErrorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    return error.data?.message || error.statusText || `Route error ${error.status}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown route error';
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const message = useMemo(() => getErrorMessage(error), [error]);

  return (
    <main className="min-h-screen px-4 py-4 md:px-6 md:py-6">
      <div className="mx-auto flex max-w-[90rem] flex-col gap-6">
        <Card className="rounded-[2rem] border-border/70 bg-background/70 p-5 shadow-lg shadow-slate-900/5">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <strong className="text-3xl font-semibold text-foreground">Kitto</strong>
            <nav className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link to={SiteRoutes.home.path}>Home</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link to={SiteRoutes.catalog.path}>Schemas</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link to={SiteRoutes.chat.path}>Chat</Link>
              </Button>
            </nav>
          </header>
        </Card>

        <Card className="rounded-[2rem] border-border/70 bg-card/95">
          <CardHeader className="border-b border-border/60 pb-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertTriangle className="size-5" />
              <CardTitle className="text-2xl font-semibold">Something broke on this route</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-6">
            <div className="rounded-[1.5rem] border border-border/70 bg-background/70 px-5 py-4 text-sm text-muted-foreground">
              {message}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => window.location.reload()}>
                <RefreshCcw className="size-4" />
                Reload
              </Button>
              <Button asChild>
                <Link to={SiteRoutes.chat.path}>Back to chat</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
