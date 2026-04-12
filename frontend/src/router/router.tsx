/* eslint-disable react-refresh/only-export-components */
import { lazy, Suspense } from 'react';
import { Navigate, createBrowserRouter } from 'react-router-dom';
import { RouteErrorBoundary } from '@components/RouteErrorBoundary/RouteErrorBoundary';
import { BaseLayout } from '@layouts/BaseLayout';
import { SiteRoutes } from './siteRoutes';

const CatalogPage = lazy(() => import('@pages/Catalog/Catalog'));
const ChatPage = lazy(() => import('@pages/Chat/Chat'));

function RouteFallback() {
  return <div className="rounded-[1.5rem] border border-border/70 bg-card/80 p-6 text-sm text-muted-foreground">Loading page…</div>;
}

export const router = createBrowserRouter([
  {
    element: <BaseLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: SiteRoutes.home.path,
        element: <Navigate to={SiteRoutes.chat.path} replace />,
      },
      {
        path: SiteRoutes.chat.path,
        element: (
          <Suspense fallback={<RouteFallback />}>
            <ChatPage />
          </Suspense>
        ),
      },
      {
        path: SiteRoutes.catalog.path,
        element: (
          <Suspense fallback={<RouteFallback />}>
            <CatalogPage />
          </Suspense>
        ),
      },
    ],
  },
]);
