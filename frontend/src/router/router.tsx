import { RouteErrorBoundary } from '@components/ErrorFallback/RouteErrorBoundary';
import { createBrowserRouter } from 'react-router-dom';
import { BaseLayout } from '@layouts/BaseLayout';
import ChatPage from '@pages/Chat/Chat';
import ElementsPage from '@pages/Elements/Elements';
import { SiteRoutes } from './siteRoutes';

export const router = createBrowserRouter([
  {
    element: <BaseLayout />,
    errorElement: <RouteErrorBoundary />,
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
        element: <ElementsPage />,
      },
    ],
  },
]);
