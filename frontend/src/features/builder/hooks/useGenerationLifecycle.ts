import { useEffect, useRef, type MutableRefObject } from 'react';
import { generateBuilderDefinition } from '@features/builder/api/generateDefinition';
import { createRequestId } from '@features/builder/api/requestId';
import { getBuilderRequestErrorMessage } from '@features/builder/api/requestErrors';
import { BuilderStreamTimeoutError, type BuilderStreamTimeoutKind } from '@features/builder/api/streamGenerate';
import { builderActions } from '@features/builder/store/builderSlice';
import { selectIsStreaming } from '@features/builder/store/selectors';
import type { BuilderChatNotice, BuilderGeneratedDraft, BuilderLlmRequest, BuilderRequestId } from '@features/builder/types';
import { getBackendApiBaseUrl } from '@helpers/environment';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { store } from '@store/store';

interface UseGenerationLifecycleOptions {
  abortControllerRef: MutableRefObject<AbortController | null>;
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  clearStreamingSummaryMessage: (requestId: BuilderRequestId) => void;
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
  streamMaxDurationMs: number | null;
}

type CancelRequest = (requestId: BuilderRequestId, options?: { abort?: boolean }) => void;

export class BuilderRequestAbortedError extends Error {
  constructor() {
    super('The builder request was intentionally aborted.');
    this.name = 'BuilderRequestAbortedError';
  }
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

const USER_CANCELLED_NOTICE = 'Cancelled the in-progress generation at your request.';
const GENERATION_FAILED_NOTICE =
  "Something went wrong and your request couldn’t be completed. The previous valid app was kept. Please retry.";

export function useGenerationLifecycle({
  abortControllerRef,
  cancelActiveRequestRef,
  clearStreamingSummaryMessage,
  onSystemNotice,
  streamMaxDurationMs,
}: UseGenerationLifecycleOptions) {
  const dispatch = useAppDispatch();
  const activeRequestIdRef = useRef<BuilderRequestId | null>(null);
  const cancelRequestRef = useRef<CancelRequest | null>(null);
  const userCancelledRequestIdRef = useRef<BuilderRequestId | null>(null);
  const isStreaming = useAppSelector(selectIsStreaming);
  const isSubmitting = isStreaming;

  useEffect(() => {
    return () => {
      const requestId = activeRequestIdRef.current;

      if (requestId) {
        cancelRequestRef.current?.(requestId, { abort: true });
      }
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
    const isTrackedActiveRequest = activeRequestIdRef.current === requestId;
    const isCurrentStreamingRequest = store.getState().builder.currentRequestId === requestId;

    if (!isTrackedActiveRequest && !isCurrentStreamingRequest) {
      return;
    }

    const didUserCancelRequest = consumeUserCancelledRequest(requestId);
    const shouldAppendUserCancelNotice = isCurrentStreamingRequest && didUserCancelRequest;
    clearStreamingSummaryMessage(requestId);

    if (options?.abort) {
      abortRequestHandles(requestId);
    } else {
      clearRequestHandles(requestId);
    }

    clearActiveRequest(requestId);
    if (isCurrentStreamingRequest) {
      dispatch(builderActions.cancelStreaming({ requestId }));
    }

    if (shouldAppendUserCancelNotice) {
      dispatch(
        builderActions.appendChatMessage({
          content: USER_CANCELLED_NOTICE,
          role: 'system',
        }),
      );
    }
  }

  useEffect(() => {
    cancelRequestRef.current = cancelRequest;
  });

  function failRequest(requestId: BuilderRequestId, error: unknown, options?: { abort?: boolean; retryPrompt?: string | null }) {
    const technicalDetails = getBuilderRequestErrorMessage(error);
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
        message: GENERATION_FAILED_NOTICE,
        retryPrompt: options?.retryPrompt ?? null,
        technicalDetails,
      }),
    );
  }

  function handleStreamTimeout(requestId: BuilderRequestId, kind: BuilderStreamTimeoutKind, retryPrompt: string) {
    if (!isActiveRequest(requestId)) {
      return;
    }

    failRequest(requestId, new BuilderStreamTimeoutError(kind), { abort: true, retryPrompt });
  }

  async function runGenerateRequest(
    requestId: BuilderRequestId,
    request: BuilderLlmRequest,
    options?: { requestKind?: 'automatic-repair' | 'stream-fallback'; transportRequestId?: BuilderRequestId },
  ): Promise<BuilderGeneratedDraft> {
    throwIfInactiveRequest(requestId);

    if (streamMaxDurationMs === null) {
      throw new Error('Chat send is unavailable until the runtime config has loaded.');
    }

    const transportRequestId = options?.transportRequestId ?? requestId;
    const response = await generateBuilderDefinition({
      apiBaseUrl: getBackendApiBaseUrl(),
      requestId: transportRequestId,
      requestKind: options?.requestKind,
      request,
      signal: abortControllerRef.current?.signal,
      timeoutMs: streamMaxDurationMs,
    });

    return {
      ...response,
      commitSource: 'fallback',
      requestId: transportRequestId,
    };
  }

  function beginGeneration(prompt: string) {
    const requestId = createRequestId();
    const previousRequestId = activeRequestIdRef.current;
    onSystemNotice(null);

    if (previousRequestId) {
      cancelRequest(previousRequestId, { abort: true });
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
      cancelRequestRef.current?.(requestId, { abort: true });
    };
  }, [cancelActiveRequestRef, onSystemNotice]);

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
