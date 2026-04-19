import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@components/ui/button';
import { BootLoader } from '@features/builder/components/BootLoader';
import { useBuilderBootstrap } from '@features/builder/hooks/useBuilderBootstrap';
import { StatusBadge } from '@features/builder/components/StatusBadge';
import { cn } from '@lib/utils';
import { SiteRoutes } from '@router/siteRoutes';

export function BaseLayout() {
  const location = useLocation();
  const { connectionStatus, hasResolvedBootstrap, model } = useBuilderBootstrap();
  const activePath = location.pathname;
  const isChatRoute = activePath === SiteRoutes.home.path || activePath === SiteRoutes.chat.path;
  const isChatActive = isChatRoute;

  return (
    <div className={cn(isChatRoute ? 'h-dvh' : 'min-h-screen')}>
      {!hasResolvedBootstrap ? <BootLoader /> : null}
      <div
        className={cn(
          'mx-auto flex max-w-[90rem] flex-col px-4 py-4 sm:px-6 lg:px-8',
          isChatRoute ? 'h-full' : 'min-h-screen',
        )}
      >
        <header className="mb-2 flex flex-wrap items-center justify-between gap-3 py-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <strong className="block text-2xl font-semibold tracking-tight text-slate-950">Kitto</strong>
            <span className="text-xs font-medium tracking-[0.08em] text-slate-500">(openui)</span>
            <StatusBadge model={model} status={connectionStatus} />
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant={isChatActive ? 'default' : 'ghost'}>
              <NavLink to={SiteRoutes.home.path} end>
                Chat
              </NavLink>
            </Button>
            <Button asChild size="sm" variant={activePath === SiteRoutes.elements.path ? 'default' : 'ghost'}>
              <NavLink to={SiteRoutes.elements.path}>
                Schemas
              </NavLink>
            </Button>
          </nav>
        </header>

        <main className="flex flex-1 min-h-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
