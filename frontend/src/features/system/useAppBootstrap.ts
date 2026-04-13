import type { SerializedError } from '@reduxjs/toolkit';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { useRuntimeConfigQuery } from '@api/apiSlice';
import { useBackendHealthPolling } from './useBackendStatus';

function getHealthErrorMessage(error: FetchBaseQueryError | SerializedError | undefined) {
  if (!error) {
    return 'Backend health check failed.';
  }

  if ('status' in error) {
    if ('error' in error && typeof error.error === 'string' && error.error.trim().length > 0) {
      return error.error;
    }

    if (typeof error.data === 'string' && error.data.trim().length > 0) {
      return error.data;
    }

    if (error.data && typeof error.data === 'object' && 'message' in error.data && typeof error.data.message === 'string') {
      return error.data.message;
    }

    return `Health check failed with status ${String(error.status)}.`;
  }

  if (typeof error.message === 'string' && error.message.trim().length > 0) {
    return error.message;
  }

  return 'Backend health check failed.';
}

export function useAppBootstrap() {
  const health = useBackendHealthPolling();

  useRuntimeConfigQuery(undefined, {
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const hasBootstrapped = Boolean(health.data);
  const isBootstrapping = !hasBootstrapped && (health.isLoading || health.isFetching || health.isUninitialized);
  const hasBootError = !hasBootstrapped && health.isError && !health.isFetching;

  return {
    hasBootError,
    healthErrorMessage: hasBootError ? getHealthErrorMessage(health.error) : null,
    isBootstrapping,
    retryHealthCheck: health.refetch,
  };
}
