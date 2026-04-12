import { useHealthQuery } from '@api/apiSlice';
import { FullscreenBootLoader } from '@features/builder/components/FullscreenBootLoader';
import { RouterProvider } from 'react-router-dom';
import { router } from '@router/router';

export default function App() {
  const { data, error, isLoading } = useHealthQuery(undefined, {
    pollingInterval: 30000,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  if (isLoading && !data && !error) {
    return <FullscreenBootLoader />;
  }

  return <RouterProvider router={router} />;
}
