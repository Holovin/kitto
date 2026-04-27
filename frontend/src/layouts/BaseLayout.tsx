import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@components/ui/button';
import { BackendConnectionStateProvider } from '@pages/Chat/builder/context/backendConnectionState';
import { BootLoader } from '@pages/Chat/builder/components/BootLoader';
import { useBuilderBootstrap } from '@pages/Chat/builder/hooks/useBuilderBootstrap';
import { StatusBadge } from '@pages/Chat/builder/components/StatusBadge';
import { cn } from '@helpers/utils';
import { SiteRoutes } from '@router/siteRoutes';

export function BaseLayout() {
  const location = useLocation();
  const { connectionStatus, hasResolvedBootstrap, model } = useBuilderBootstrap();
  const activePath = location.pathname;
  const isBuilderRoute = activePath === SiteRoutes.home.path || activePath === SiteRoutes.chat.path;

  return (
    <div className={cn(isBuilderRoute ? 'h-dvh' : 'min-h-screen')}>
      {!hasResolvedBootstrap ? <BootLoader /> : null}
      <div
        className={cn(
          'mx-auto flex max-w-[90rem] flex-col px-4 py-4 sm:px-6 lg:px-8',
          isBuilderRoute ? 'h-full' : 'min-h-screen',
        )}
      >
        <header className="mb-2 flex flex-wrap items-center justify-between gap-3 py-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <strong className="block text-2xl font-semibold tracking-tight text-slate-950">Kitto</strong>
            <span className="text-xs font-medium tracking-[0.08em] text-slate-500">(openui)</span>
            <StatusBadge model={model} status={connectionStatus} />
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            <Button
              asChild
              className={cn(isBuilderRoute && '!text-white')}
              size="sm"
              variant={isBuilderRoute ? 'default' : 'ghost'}
            >
              <NavLink to={SiteRoutes.home.path} end>
                Chat
              </NavLink>
            </Button>
            <Button
              asChild
              className={cn(activePath === SiteRoutes.elements.path && '!text-white')}
              size="sm"
              variant={activePath === SiteRoutes.elements.path ? 'default' : 'ghost'}
            >
              <NavLink to={SiteRoutes.elements.path}>
                Schema
              </NavLink>
            </Button>
          </nav>
        </header>

        <main className="flex flex-1 min-h-0">
          <BackendConnectionStateProvider isError={connectionStatus === 'disconnected'}>
            <Outlet />
          </BackendConnectionStateProvider>
        </main>
      </div>
    </div>
  );
}
