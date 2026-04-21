import { nanoid } from '@reduxjs/toolkit';
import { useEffect, useRef, type MutableRefObject } from 'react';
import { generateBuilderDefinition } from '@features/builder/api/generateDefinition';
import { getBuilderRequestErrorMessage } from '@features/builder/api/requestErrors';
import { BuilderStreamTimeoutError, type BuilderStreamTimeoutKind } from '@features/builder/api/streamGenerate';
import { builderActions } from '@features/builder/store/builderSlice';
import { selectIsStreaming } from '@features/builder/store/selectors';
import type { BuilderChatNotice, BuilderLlmRequest, BuilderLlmResponse, BuilderRequestId } from '@features/builder/types';
import { getBackendApiBaseUrl } from '@helpers/environment';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { store } from '@store/store';

interface UseGenerationLifecycleOptions {
  abortControllerRef: MutableRefObject<AbortController | null>;
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  clearStreamingSummaryMessage: (requestId: BuilderRequestId) => void;
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
  streamMaxDurationMs: number;
}

export class BuilderRequestAbortedError extends Error {
  constructor() {
    super('The builder request was intentionally aborted.');
    this.name = 'BuilderRequestAbortedError';
  }
}

function createRequestId(): BuilderRequestId {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return nanoid();
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

const USER_CANCELLED_NOTICE = 'Cancelled the in-progress generation at your request.';

export function useGenerationLifecycle({
  abortControllerRef,
  cancelActiveRequestRef,
  clearStreamingSummaryMessage,
  onSystemNotice,
  streamMaxDurationMs,
}: UseGenerationLifecycleOptions) {
  const dispatch = useAppDispatch();
  const activeRequestIdRef = useRef<BuilderRequestId | null>(null);
  const userCancelledRequestIdRef = useRef<BuilderRequestId | null>(null);
  const isStreaming = useAppSelector(selectIsStreaming);
  const isSubmitting = isStreaming;

  useEffect(() => {
    return () => {
      activeRequestIdRef.current = null;
    };
  }, []);

  function isActiveRequest(requestId: BuilderRequestId) {
    return activeRequestIdRef.current === requestId && store.getState().builder.currentRequestId === requestId;
  }

  function clearActiveRequest(requestId: BuilderRequestId) {
    if (activeRequestIdRef.current === requestId) {
      activeRequestIdRef.current = null;
    }
  }

  function clearRequestHandles(requestId: BuilderRequestId) {
    if (activeRequestIdRef.current !== requestId) {
      return;
    }

    abortControllerRef.current = null;
  }

  function consumeUserCancelledRequest(requestId: BuilderRequestId) {
    if (userCancelledRequestIdRef.current !== requestId) {
      return false;
    }

    userCancelledRequestIdRef.current = null;
    return true;
  }

  function abortRequestHandles(requestId: BuilderRequestId) {
    if (activeRequestIdRef.current !== requestId) {
      return;
    }

    const abortController = abortControllerRef.current;

    abortControllerRef.current = null;
    abortController?.abort();
  }

  function throwIfInactiveRequest(requestId: BuilderRequestId) {
    if (!isActiveRequest(requestId)) {
      throw new BuilderRequestAbortedError();
    }
  }

  function cancelRequest(requestId: BuilderRequestId, options?: { abort?: boolean }) {
    const shouldAppendUserCancelNotice = consumeUserCancelledRequest(requestId);
    clearStreamingSummaryMessage(requestId);

    if (options?.abort) {
      abortRequestHandles(requestId);
    } else {
      clearRequestHandles(requestId);
    }

    clearActiveRequest(requestId);
    dispatch(builderActions.cancelStreaming({ requestId }));

    if (shouldAppendUserCancelNotice) {
      dispatch(
        builderActions.appendChatMessage({
          content: USER_CANCELLED_NOTICE,
          role: 'system',
        }),
      );
    }
  }

  function failRequest(requestId: BuilderRequestId, error: unknown, options?: { abort?: boolean; retryPrompt?: string | null }) {
    clearStreamingSummaryMessage(requestId);

    if (options?.abort) {
      abortRequestHandles(requestId);
    } else {
      clearRequestHandles(requestId);
    }

    clearActiveRequest(requestId);
    dispatch(
      builderActions.failStreaming({
        requestId,
        message: getBuilderRequestErrorMessage(error),
        retryPrompt: options?.retryPrompt ?? null,
      }),
    );
  }

  function handleStreamTimeout(requestId: BuilderRequestId, kind: BuilderStreamTimeoutKind, retryPrompt: string) {
    if (!isActiveRequest(requestId)) {
      return;
    }

    failRequest(requestId, new BuilderStreamTimeoutError(kind), { abort: true, retryPrompt });
  }

  async function runGenerateRequest(requestId: BuilderRequestId, request: BuilderLlmRequest): Promise<BuilderLlmResponse> {
    throwIfInactiveRequest(requestId);

    return generateBuilderDefinition({
      apiBaseUrl: getBackendApiBaseUrl(),
      requestId,
      request,
      signal: abortControllerRef.current?.signal,
      timeoutMs: streamMaxDurationMs,
    });
  }

  function beginGeneration(prompt: string) {
    const requestId = createRequestId();
    const previousRequestId = activeRequestIdRef.current;
    onSystemNotice(null);

    if (previousRequestId) {
      abortRequestHandles(previousRequestId);
    }

    activeRequestIdRef.current = requestId;
    dispatch(builderActions.beginStreaming({ prompt, requestId }));

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    return {
      abortController,
      requestId,
    };
  }

  function completeGeneration(requestId: BuilderRequestId) {
    clearRequestHandles(requestId);
    clearActiveRequest(requestId);
  }

  function finalizeGeneration(requestId: BuilderRequestId, abortController: AbortController) {
    if (isActiveRequest(requestId)) {
      cancelRequest(requestId);
    }

    if (abortControllerRef.current === abortController) {
      abortControllerRef.current = null;
    }
  }

  function cancelActiveRequest() {
    const requestId = activeRequestIdRef.current;

    if (!requestId) {
      return;
    }

    onSystemNotice(null);
    cancelRequest(requestId, { abort: true });
  }

  function handleCancel() {
    const requestId = activeRequestIdRef.current;

    if (requestId) {
      userCancelledRequestIdRef.current = requestId;
    }

    cancelActiveRequest();
  }

  useEffect(() => {
    cancelActiveRequestRef.current = () => {
      const requestId = activeRequestIdRef.current;

      if (!requestId) {
        return;
      }

      onSystemNotice(null);
      const shouldAppendUserCancelNotice = userCancelledRequestIdRef.current === requestId;

      clearStreamingSummaryMessage(requestId);

      const abortController = abortControllerRef.current;
      abortControllerRef.current = null;
      abortController?.abort();

      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = null;
      }

      dispatch(builderActions.cancelStreaming({ requestId }));

      if (shouldAppendUserCancelNotice) {
        userCancelledRequestIdRef.current = null;
        dispatch(
          builderActions.appendChatMessage({
            content: USER_CANCELLED_NOTICE,
            role: 'system',
          }),
        );
      }
    };
  }, [abortControllerRef, cancelActiveRequestRef, clearStreamingSummaryMessage, dispatch, onSystemNotice]);

  return {
    beginGeneration,
    cancelRequest,
    completeGeneration,
    failRequest,
    finalizeGeneration,
    handleCancel,
    handleStreamTimeout,
    isActiveRequest,
    isSubmitting,
    runGenerateRequest,
    throwIfInactiveRequest,
  };
}
