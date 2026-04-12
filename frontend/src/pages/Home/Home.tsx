import { ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card';
import { SiteRoutes } from '@router/siteRoutes';

export default function HomePage() {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
      <Card className="border-white/70 bg-white/92">
        <CardHeader className="space-y-3">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Overview</p>
          <CardTitle className="max-w-3xl text-4xl leading-tight">
            Build small browser apps by chatting with an OpenUI runtime instead of hand-editing component trees.
          </CardTitle>
          <CardDescription className="max-w-2xl text-base leading-7">
            Kitto keeps router, Redux Toolkit, redux-remember, and RTK Query intact while layering a builder UI on
            top of the existing Vite shell.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to={SiteRoutes.chat.path}>
              Open /chat
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-slate-50/85 shadow-none">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-white p-3 shadow-sm">
              <Sparkles className="h-5 w-5 text-slate-900" />
            </div>
            <div>
              <CardTitle className="text-2xl">Core capabilities</CardTitle>
              <CardDescription>Everything runs in the browser after generation.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-slate-700">
          <p>Chat-driven app creation with live preview and Definition source tabs.</p>
          <p>Local persistence through Redux Toolkit + redux-remember.</p>
          <p>Import/export JSON definitions, undo latest change, and runtime support for forms, collections, and filtering.</p>
        </CardContent>
      </Card>
    </section>
  );
}
