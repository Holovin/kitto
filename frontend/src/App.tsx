import { FullscreenBootErrorState, FullscreenBootLoader } from '@features/builder/components/FullscreenBootLoader';
import { useAppBootstrap } from '@features/system/useAppBootstrap';
import { RouterProvider } from 'react-router-dom';
import { router } from '@router/router';

export default function App() {
  const { hasBootError, healthErrorMessage, isBootstrapping, retryHealthCheck } = useAppBootstrap();

  if (isBootstrapping) {
    return <FullscreenBootLoader />;
  }

  if (hasBootError) {
    return <FullscreenBootErrorState message={healthErrorMessage} onRetry={() => void retryHealthCheck()} />;
  }

  return <RouterProvider router={router} />;
}
