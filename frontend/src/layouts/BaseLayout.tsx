import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { buttonVariants } from '@components/ui/button';
import { Card } from '@components/ui/card';
import { StatusBadge } from '@features/builder/components/StatusBadge';
import { cn } from '@lib/utils';
import { SiteRoutes } from '@router/siteRoutes';

export function BaseLayout() {
  const location = useLocation();
  const isChatRoute = location.pathname === SiteRoutes.home.path || location.pathname === SiteRoutes.chat.path;

  return (
    <div className={cn('px-3 py-3 md:px-4 md:py-4', isChatRoute ? 'h-dvh overflow-hidden' : 'min-h-screen')}>
      <div className={cn('mx-auto flex max-w-[90rem] flex-col', isChatRoute ? 'h-full min-h-0 gap-4' : 'gap-6')}>
        <Card className="shrink-0 rounded-[2rem] border-border/70 bg-background/70 p-4 shadow-lg shadow-slate-900/5 md:px-5 md:py-4">
          <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-col leading-none">
                <strong className="font-sans text-2xl font-semibold tracking-tight text-foreground md:text-3xl">Kitto</strong>
                <span className="pt-1 text-xs font-medium text-muted-foreground">json-renderer</span>
              </div>
              <StatusBadge />
            </div>

            <nav className="flex flex-wrap gap-2">
              <NavLink
                to={SiteRoutes.home.path}
                className={cn(buttonVariants({ variant: isChatRoute ? 'default' : 'outline', size: 'sm' }), 'rounded-full')}
              >
                Chat
              </NavLink>
              <NavLink
                to={SiteRoutes.catalog.path}
                className={({ isActive }) =>
                  cn(buttonVariants({ variant: isActive ? 'default' : 'outline', size: 'sm' }), 'rounded-full')
                }
              >
                Schemas
              </NavLink>
            </nav>
          </header>
        </Card>

        <div className={cn(isChatRoute && 'flex min-h-0 flex-1 overflow-hidden')}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
