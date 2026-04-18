import { useConfigQuery, useHealthQuery } from '@api/apiSlice';
import type { BuilderConnectionStatus } from '@features/builder/types';

const HEALTH_POLLING_OPTIONS = {
  pollingInterval: 30_000,
  refetchOnFocus: true,
  refetchOnReconnect: true,
} as const;

export function useBackendConnectionState() {
  return useHealthQuery(undefined, {
    ...HEALTH_POLLING_OPTIONS,
    selectFromResult: ({ isError }) => ({
      isError,
    }),
  });
}

export function useBuilderBootstrap() {
  const configState = useConfigQuery(undefined, {
    selectFromResult: ({ isError, isSuccess }) => ({
      isError,
      isSuccess,
    }),
  });
  const healthState = useHealthQuery(undefined, {
    ...HEALTH_POLLING_OPTIONS,
    selectFromResult: ({ data, isError, isSuccess }) => ({
      isError,
      isSuccess,
      model: data?.model,
    }),
  });
  const hasResolvedConfig = configState.isSuccess || configState.isError;
  const hasResolvedHealthCheck = healthState.isSuccess || healthState.isError;
  const connectionStatus: BuilderConnectionStatus = !hasResolvedHealthCheck
    ? 'loading'
    : healthState.isSuccess
      ? 'connected'
      : 'disconnected';

  return {
    connectionStatus,
    hasResolvedBootstrap: hasResolvedConfig && hasResolvedHealthCheck,
    model: healthState.model,
  };
}
