import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { useBackendStatus } from '@features/system/useBackendStatus';
import { SiteRoutes } from '@router/siteRoutes';

export default function HomePage() {
  const { model } = useBackendStatus();

  return (
    <section>
      <Card className="overflow-hidden border-border/70 bg-card/95">
        <CardHeader>
          <CardTitle className="font-serif text-4xl leading-tight">Kitto</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to={SiteRoutes.chat.path}>
              Open builder
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to={SiteRoutes.catalog.path}>Open catalog</Link>
          </Button>
          <div className="rounded-full border border-border/70 bg-background/70 px-4 py-2 text-sm text-muted-foreground">
            Backend model: {model}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
