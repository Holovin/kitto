import { useConfigQuery, useHealthQuery } from '@api/apiSlice';
import { getBuilderRuntimeConfigStatus } from '@features/builder/config';
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
    selectFromResult: ({ data, isError }) => ({
      data,
      isError,
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
  const hasResolvedHealthCheck = healthState.isSuccess || healthState.isError;
  const connectionStatus: BuilderConnectionStatus = !hasResolvedHealthCheck
    ? 'loading'
    : healthState.isSuccess
      ? 'connected'
      : 'disconnected';

  return {
    connectionStatus,
    configStatus: getBuilderRuntimeConfigStatus(configState),
    hasResolvedBootstrap: hasResolvedHealthCheck,
    model: healthState.model,
  };
}
