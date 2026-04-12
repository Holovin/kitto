import { LoaderCircle } from 'lucide-react';
import { Card, CardContent } from '@components/ui/card';

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
