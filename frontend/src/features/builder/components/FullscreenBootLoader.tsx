import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card';

export function FullscreenBootLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md border-border/60 bg-card/90">
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <LoaderCircle className="size-10 animate-spin text-primary" />
          <p className="font-serif text-2xl text-foreground">Kitto</p>
        </CardContent>
      </Card>
    </div>
  );
}

type FullscreenBootErrorStateProps = {
  message: string | null;
  onRetry: () => void;
};

export function FullscreenBootErrorState({ message, onRetry }: FullscreenBootErrorStateProps) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md border-destructive/20 bg-card/95">
        <CardHeader className="items-center text-center">
          <div className="mb-2 rounded-full bg-destructive/10 p-3 text-destructive">
            <AlertTriangle className="size-6" />
          </div>
          <p className="font-serif text-2xl text-foreground">Kitto</p>
          <CardTitle>Backend unavailable</CardTitle>
          <CardDescription>Application startup is waiting for a successful health check.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">{message ?? 'Health check failed.'}</p>
          <Button size="lg" type="button" onClick={onRetry}>
            Retry health check
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
