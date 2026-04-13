import { apiSlice, useHealthQuery } from '@api/apiSlice';
import type { HealthResponse } from '@features/builder/api/contracts';
import { useAppSelector } from '@store/hooks';

export type BackendStatus = 'booting' | 'healthy' | 'misconfigured' | 'offline';

export const DEFAULT_BACKEND_MODEL = 'gpt-5.4-mini';

const selectHealthResult = apiSlice.endpoints.health.select(undefined);

type BackendStatusSource = {
  data?: HealthResponse;
  isBooting?: boolean;
};

export function deriveBackendStatus({ data, isBooting }: BackendStatusSource): BackendStatus {
  if (!data && isBooting) {
    return 'booting';
  }

  if (data?.openaiConfigured === false) {
    return 'misconfigured';
  }

  if (data) {
    return 'healthy';
  }

  return 'offline';
}

export function useBackendHealthPolling() {
  return useHealthQuery(undefined, {
    pollingInterval: 30_000,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });
}

export function useBackendStatus() {
  const health = useAppSelector(selectHealthResult);
  const data = health.data;
  const isBooting = health.status === 'pending';

  return {
    status: deriveBackendStatus({
      data,
      isBooting,
    }),
    data: data ?? null,
    model: data?.model ?? DEFAULT_BACKEND_MODEL,
    openaiConfigured: data?.openaiConfigured ?? null,
    error: health.error,
    isFetching: isBooting,
  };
}
