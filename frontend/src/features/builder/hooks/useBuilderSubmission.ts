import { nanoid } from '@reduxjs/toolkit';
import { useCallback, useEffect, useRef, type FormEvent, type MutableRefObject } from 'react';
import { useConfigQuery } from '@api/apiSlice';
import { generateBuilderDefinition } from '@features/builder/api/generateDefinition';
import { getBuilderRequestErrorMessage } from '@features/builder/api/requestErrors';
import {
  BuilderStreamTimeoutError,
  streamBuilderDefinition,
  type BuilderStreamTimeoutKind,
} from '@features/builder/api/streamGenerate';
import { getBuilderRequestLimits, getBuilderStreamTimeouts, validateBuilderLlmRequest } from '@features/builder/config';
import { buildRequestChatHistory } from '@features/builder/hooks/requestChatHistory';
import { buildRepairPrompt, MAX_AUTO_REPAIR_ATTEMPTS } from '@features/builder/hooks/repairPrompt';
import { resolveBuilderComposerPrompt } from '@features/builder/hooks/submissionPrompt';
import { createValidationFailureMessage } from '@features/builder/hooks/validationFailureMessage';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { validateOpenUiSource } from '@features/builder/openui/runtime/validation';
import {
  selectChatMessages,
  selectCommittedSource,
  selectDomainData,
  selectDraftPrompt,
  selectIsStreaming,
  selectRetryPrompt,
} from '@features/builder/store/selectors';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import type { BuilderLlmRequest, BuilderLlmRequestCompaction, BuilderLlmResponse, BuilderRequestId } from '@features/builder/types';
import { getBackendApiBaseUrl } from '@helpers/environment';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { store } from '@store/store';

function createCompactionNotice(compaction?: BuilderLlmRequestCompaction) {
  if (!compaction || compaction.omittedChatMessages <= 0) {
    return null;
  }

  const omittedLabel = compaction.omittedChatMessages === 1 ? '1 older message' : `${compaction.omittedChatMessages} older messages`;
  const omittedVerb = compaction.omittedChatMessages === 1 ? 'was' : 'were';

  if (compaction.compactedByBytes) {
    return `The request was too large, so ${omittedLabel} ${omittedVerb} omitted before sending it to the model.`;
  }

  if (compaction.compactedByItemLimit) {
    return `The chat context was compacted to the most recent window, so ${omittedLabel} ${omittedVerb} omitted from this request.`;
  }

  return null;
}

interface UseBuilderSubmissionOptions {
  abortControllerRef: MutableRefObject<AbortController | null>;
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  onFeedbackChange: (message: string | null) => void;
}

class OpenUiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenUiValidationError';
  }
}

class BuilderRequestAbortedError extends Error {
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

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export function useBuilderSubmission({ abortControllerRef, cancelActiveRequestRef, onFeedbackChange }: UseBuilderSubmissionOptions) {
  const dispatch = useAppDispatch();
  const activeRequestIdRef = useRef<BuilderRequestId | null>(null);
  const handleCancelRef = useRef<() => void>(() => {});
  const chatMessages = useAppSelector(selectChatMessages);
  const committedSource = useAppSelector(selectCommittedSource);
  const domainData = useAppSelector(selectDomainData);
  const draftPrompt = useAppSelector(selectDraftPrompt);
  const isStreaming = useAppSelector(selectIsStreaming);
  const retryPrompt = useAppSelector(selectRetryPrompt);
  const configState = useConfigQuery(undefined, {
    selectFromResult: ({ data }) => ({
      data,
    }),
  });
  const requestLimits = getBuilderRequestLimits(configState.data);
  const streamTimeouts = getBuilderStreamTimeouts(configState.data);
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
    if (options?.abort) {
      abortRequestHandles(requestId);
    } else {
      clearRequestHandles(requestId);
    }

    clearActiveRequest(requestId);
    dispatch(builderActions.cancelStreaming({ requestId }));
  }

  function failRequest(requestId: BuilderRequestId, error: unknown, options?: { abort?: boolean; retryPrompt?: string | null }) {
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

  async function runGenerateRequest(requestId: BuilderRequestId, request: BuilderLlmRequest) {
    throwIfInactiveRequest(requestId);

    return generateBuilderDefinition({
      apiBaseUrl: getBackendApiBaseUrl(),
      request,
      signal: abortControllerRef.current?.signal,
      timeoutMs: streamTimeouts.streamMaxDurationMs,
    });
  }

  async function ensureValidGeneratedSource(initialSource: string, request: BuilderLlmRequest, requestId: BuilderRequestId) {
    let candidateSource = initialSource;
    let attempt = 0;
    let hasAnnouncedRepair = false;
    let hasCompletedRepairRequest = false;

    while (attempt <= MAX_AUTO_REPAIR_ATTEMPTS) {
      const validation = validateOpenUiSource(candidateSource);

      if (validation.isValid) {
        return {
          note: hasCompletedRepairRequest ? 'The first draft had parser issues, so it was repaired automatically before commit.' : undefined,
          source: candidateSource,
        };
      }

      attempt += 1;

      if (attempt > MAX_AUTO_REPAIR_ATTEMPTS) {
        throw new OpenUiValidationError(createValidationFailureMessage(validation.issues, MAX_AUTO_REPAIR_ATTEMPTS));
      }

      const repairRequest: BuilderLlmRequest = {
        prompt: buildRepairPrompt({
          userPrompt: request.prompt,
          committedSource: request.currentSource,
          invalidSource: candidateSource,
          issues: validation.issues,
          attemptNumber: attempt,
          promptMaxChars: requestLimits.promptMaxChars,
        }),
        currentSource: request.currentSource,
        chatHistory: request.chatHistory,
      };
      const repairRequestValidationError = validateBuilderLlmRequest(repairRequest, requestLimits);

      if (repairRequestValidationError) {
        throw new Error(repairRequestValidationError);
      }

      if (!hasAnnouncedRepair) {
        throwIfInactiveRequest(requestId);
        dispatch(
          builderActions.appendChatMessage({
            role: 'system',
            tone: 'info',
            content: 'The model returned an invalid draft. Sending one automatic repair request now.',
          }),
        );
        hasAnnouncedRepair = true;
      }

      const repairedResponse = await runGenerateRequest(requestId, repairRequest);
      throwIfInactiveRequest(requestId);
      hasCompletedRepairRequest = true;
      candidateSource = repairedResponse.source;
    }

    return {
      source: candidateSource,
    };
  }

  function applyCompactionNotice(requestId: BuilderRequestId, compaction?: BuilderLlmRequestCompaction) {
    const compactionNotice = createCompactionNotice(compaction);

    if (!compactionNotice || !isActiveRequest(requestId)) {
      return;
    }

    dispatch(
      builderActions.appendChatMessage({
        role: 'system',
        tone: 'info',
        content: compactionNotice,
      }),
    );
  }

  async function commitGeneratedSource(
    response: Pick<BuilderLlmResponse, 'compaction' | 'source'>,
    request: BuilderLlmRequest,
    requestId: BuilderRequestId,
  ) {
    throwIfInactiveRequest(requestId);
    const validatedResult = await ensureValidGeneratedSource(response.source, request, requestId);
    throwIfInactiveRequest(requestId);
    const snapshot = createBuilderSnapshot(validatedResult.source, {}, domainData);

    applyCompactionNotice(requestId, response.compaction);
    throwIfInactiveRequest(requestId);
    dispatch(builderSessionActions.replaceRuntimeSessionState(snapshot.runtimeState));
    dispatch(
      builderActions.completeStreaming({
        requestId,
        source: validatedResult.source,
        note: validatedResult.note,
        snapshot,
      }),
    );
    clearRequestHandles(requestId);
    clearActiveRequest(requestId);
  }

  handleCancelRef.current = () => {
    const requestId = activeRequestIdRef.current;

    if (!requestId) {
      return;
    }

    onFeedbackChange(null);
    cancelRequest(requestId, { abort: true });
  };

  const handleCancel = useCallback(() => {
    handleCancelRef.current();
  }, []);

  useEffect(() => {
    cancelActiveRequestRef.current = () => {
      handleCancel();
    };
  }, [cancelActiveRequestRef, handleCancel]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = resolveBuilderComposerPrompt({
      draftPrompt,
      retryPrompt,
    });

    if (!nextPrompt || isSubmitting) {
      return;
    }

    const request: BuilderLlmRequest = {
      prompt: nextPrompt,
      currentSource: committedSource,
      chatHistory: buildRequestChatHistory(chatMessages, requestLimits.chatHistoryMaxItems),
    };
    const requestValidationError = validateBuilderLlmRequest(request, requestLimits);

    if (requestValidationError) {
      onFeedbackChange(requestValidationError);
      return;
    }

    let receivedChunk = false;
    const requestId = createRequestId();
    const previousRequestId = activeRequestIdRef.current;
    onFeedbackChange(null);
    if (previousRequestId) {
      abortRequestHandles(previousRequestId);
    }

    activeRequestIdRef.current = requestId;
    dispatch(builderActions.beginStreaming({ prompt: nextPrompt, requestId }));

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const streamResult = await streamBuilderDefinition({
        apiBaseUrl: getBackendApiBaseUrl(),
        idleTimeoutMs: streamTimeouts.streamIdleTimeoutMs,
        maxDurationMs: streamTimeouts.streamMaxDurationMs,
        request,
        signal: abortController.signal,
        onChunk: (chunk) => {
          receivedChunk = true;
          dispatch(builderActions.appendStreamChunk({ requestId, chunk }));
        },
        onTimeout: (kind) => {
          handleStreamTimeout(requestId, kind, request.prompt);
        },
      });

      await commitGeneratedSource(streamResult, request, requestId);
    } catch (error) {
      if (error instanceof BuilderStreamTimeoutError) {
        if (isActiveRequest(requestId)) {
          failRequest(requestId, error, { retryPrompt: request.prompt });
        }

        return;
      }

      if (isAbortError(error) || error instanceof BuilderRequestAbortedError || !isActiveRequest(requestId)) {
        cancelRequest(requestId);
        return;
      }

      if (!receivedChunk) {
        try {
          const fallbackResponse = await runGenerateRequest(requestId, request);
          await commitGeneratedSource(fallbackResponse, request, requestId);
          return;
        } catch (fallbackError) {
          if (fallbackError instanceof BuilderStreamTimeoutError) {
            if (isActiveRequest(requestId)) {
              failRequest(requestId, fallbackError, { retryPrompt: request.prompt });
            }

            return;
          }

          if (
            isAbortError(fallbackError) ||
            fallbackError instanceof BuilderRequestAbortedError ||
            !isActiveRequest(requestId)
          ) {
            cancelRequest(requestId);
            return;
          }

          failRequest(requestId, fallbackError, { retryPrompt: request.prompt });
          return;
        }
      }

      failRequest(requestId, error, { retryPrompt: request.prompt });
    } finally {
      if (isActiveRequest(requestId)) {
        cancelRequest(requestId);
      }

      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  }

  function handleDraftPromptChange(value: string) {
    dispatch(builderActions.setDraftPrompt(value));
  }

  return {
    draftPrompt,
    handleDraftPromptChange,
    handleCancel,
    handleSubmit,
    isSubmitting,
    promptMaxChars: requestLimits.promptMaxChars,
    retryPrompt,
  };
}
