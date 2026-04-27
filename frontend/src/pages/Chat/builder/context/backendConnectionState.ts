import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';

interface BackendConnectionState {
  isError: boolean;
}

interface BackendConnectionStateProviderProps extends BackendConnectionState {
  children?: ReactNode;
}

const BackendConnectionStateContext = createContext<BackendConnectionState | null>(null);

export function BackendConnectionStateProvider({ children, isError }: BackendConnectionStateProviderProps) {
  const value = useMemo(
    () => ({
      isError,
    }),
    [isError],
  );

  return createElement(BackendConnectionStateContext.Provider, { value }, children);
}

export function useOptionalBackendConnectionState() {
  return useContext(BackendConnectionStateContext);
}
