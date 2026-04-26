import { RouteErrorBoundary } from '@components/ErrorFallback/RouteErrorBoundary';
import { createBrowserRouter } from 'react-router-dom';
import { BaseLayout } from '@layouts/BaseLayout';
import ChatPage from '@pages/Chat/Chat';
import { SiteRoutes } from './siteRoutes';

// React Router renders this during initial lazy route discovery, for example
// when opening `/elements` directly. Keep it non-null to avoid a dev warning
// without adding another visible app-level loading state.
const hydrateFallbackElement = <div aria-hidden="true" />;

export const router = createBrowserRouter([
  {
    element: <BaseLayout />,
    errorElement: <RouteErrorBoundary />,
    hydrateFallbackElement,
    children: [
      {
        path: SiteRoutes.home.path,
        element: <ChatPage />,
      },
      {
        path: SiteRoutes.chat.path,
        element: <ChatPage />,
      },
      {
        path: SiteRoutes.elements.path,
        lazy: async () => {
          const ElementsPage = await import('@pages/Elements/Elements');
          return { Component: ElementsPage.default };
        },
      },
    ],
  },
]);
