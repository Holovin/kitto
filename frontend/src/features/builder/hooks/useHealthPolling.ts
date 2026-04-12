import { useHealthQuery } from '@api/apiSlice';

const HEALTH_POLLING_OPTIONS = {
  pollingInterval: 30_000,
  refetchOnFocus: true,
  refetchOnReconnect: true,
} as const;

export function useHealthPolling() {
  return useHealthQuery(undefined, HEALTH_POLLING_OPTIONS);
}
