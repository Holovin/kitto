import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { generateBuilderDefinition } from '@pages/Chat/builder/api/generateDefinition';
import { createRequestId } from '@pages/Chat/builder/api/requestId';
import { getBuilderRequestErrorMessage } from '@pages/Chat/builder/api/requestErrors';
import { BuilderStreamTimeoutError, type BuilderStreamTimeoutKind } from '@pages/Chat/builder/api/streamGenerate';
import { useBuilderRequestControls } from '@pages/Chat/builder/context/builderRequestControls';
import { builderActions } from '@pages/Chat/builder/store/builderSlice';
import { selectCurrentRequestId } from '@pages/Chat/builder/store/selectors';
import type { BuilderChatNotice, BuilderGeneratedDraft, PromptBuildRequest, BuilderRequestId } from '@pages/Chat/builder/types';
import { getBackendApiBaseUrl } from '@helpers/environment';
import { useAppDispatch, useAppSelector } from '@store/hooks';

interface UseGenerationLifecycleOptions {
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
  clearStreamingSummaryMessage,
  onSystemNotice,
  streamMaxDurationMs,
}: UseGenerationLifecycleOptions) {
  const dispatch = useAppDispatch();
  const {
    abortActiveTransport,
    clearAbortController,
    createAbortController,
    getAbortSignal,
    registerCancelActiveRequest,
  } = useBuilderRequestControls();
  const activeRequestIdRef = useRef<BuilderRequestId | null>(null);
  const selectedCurrentRequestId = useAppSelector(selectCurrentRequestId);
  const currentRequestIdRef = useRef<BuilderRequestId | null>(selectedCurrentRequestId);
  const userCancelledRequestIdRef = useRef<BuilderRequestId | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const isSubmitting = isGenerating;

  useEffect(() => {
    currentRequestIdRef.current = selectedCurrentRequestId;
  }, [selectedCurrentRequestId]);

  function isActiveRequest(requestId: BuilderRequestId) {
    return activeRequestIdRef.current === requestId && currentRequestIdRef.current === requestId;
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

    clearAbortController();
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

    abortActiveTransport();
  }

  function throwIfInactiveRequest(requestId: BuilderRequestId) {
    if (!isActiveRequest(requestId)) {
      throw new BuilderRequestAbortedError();
    }
  }

  function cancelRequest(requestId: BuilderRequestId, options?: { abort?: boolean }) {
    const isTrackedActiveRequest = activeRequestIdRef.current === requestId;
    const isCurrentStreamingRequest = currentRequestIdRef.current === requestId;

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
    setIsGenerating(false);
    if (isCurrentStreamingRequest) {
      currentRequestIdRef.current = null;
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

  const cancelRequestEvent = useEffectEvent<CancelRequest>((requestId, options) => {
    cancelRequest(requestId, options);
  });

  useEffect(() => {
    return () => {
      const requestId = activeRequestIdRef.current;

      if (requestId) {
        cancelRequestEvent(requestId, { abort: true });
      }
    };
  }, []);

  function failRequest(requestId: BuilderRequestId, error: unknown, options?: { abort?: boolean; retryPrompt?: string | null }) {
    const technicalDetails = getBuilderRequestErrorMessage(error);
    clearStreamingSummaryMessage(requestId);

    if (options?.abort) {
      abortRequestHandles(requestId);
    } else {
      clearRequestHandles(requestId);
    }

    clearActiveRequest(requestId);
    if (currentRequestIdRef.current === requestId) {
      currentRequestIdRef.current = null;
    }
    setIsGenerating(false);
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
    request: PromptBuildRequest,
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
      signal: getAbortSignal(),
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

    setIsGenerating(true);
    activeRequestIdRef.current = requestId;
    currentRequestIdRef.current = requestId;
    dispatch(builderActions.beginStreaming({ prompt, requestId }));

    const abortController = createAbortController();

    return {
      abortController,
      requestId,
    };
  }

  function completeGeneration(requestId: BuilderRequestId) {
    clearRequestHandles(requestId);
    clearActiveRequest(requestId);
    setIsGenerating(false);
    if (currentRequestIdRef.current === requestId) {
      currentRequestIdRef.current = null;
    }
  }

  function finalizeGeneration(requestId: BuilderRequestId, abortController: AbortController) {
    if (isActiveRequest(requestId)) {
      cancelRequest(requestId);
    }

    setIsGenerating(false);
    clearAbortController(abortController);
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
    return registerCancelActiveRequest(() => {
      const requestId = activeRequestIdRef.current;

      if (!requestId) {
        return;
      }

      onSystemNotice(null);
      cancelRequestEvent(requestId, { abort: true });
    });
  }, [onSystemNotice, registerCancelActiveRequest]);

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
