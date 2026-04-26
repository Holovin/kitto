import { createContext, useContext } from 'react';

export interface BuilderRequestControls {
  abortActiveTransport: () => void;
  cancelActiveRequest: () => void;
  clearAbortController: (abortController?: AbortController) => void;
  createAbortController: () => AbortController;
  getAbortSignal: () => AbortSignal | undefined;
  registerCancelActiveRequest: (handler: (() => void) | null) => () => void;
}

export const BuilderRequestControlsContext = createContext<BuilderRequestControls | null>(null);

export function createBuilderRequestControls(): BuilderRequestControls {
  let abortController: AbortController | null = null;
  let cancelActiveRequestHandler: (() => void) | null = null;

  return {
    abortActiveTransport: () => {
      const currentAbortController = abortController;
      abortController = null;
      currentAbortController?.abort();
    },
    cancelActiveRequest: () => {
      cancelActiveRequestHandler?.();
    },
    clearAbortController: (currentAbortController?: AbortController) => {
      if (!currentAbortController || abortController === currentAbortController) {
        abortController = null;
      }
    },
    createAbortController: () => {
      abortController = new AbortController();
      return abortController;
    },
    getAbortSignal: () => abortController?.signal,
    registerCancelActiveRequest: (handler: (() => void) | null) => {
      cancelActiveRequestHandler = handler;

      return () => {
        if (cancelActiveRequestHandler === handler) {
          cancelActiveRequestHandler = null;
        }
      };
    },
  };
}

export function useBuilderRequestControls() {
  const controls = useContext(BuilderRequestControlsContext);

  if (!controls) {
    throw new Error('useBuilderRequestControls must be used within BuilderRequestControlsProvider.');
  }

  return controls;
}
