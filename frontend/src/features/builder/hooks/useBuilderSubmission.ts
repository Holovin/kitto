import type { FormEvent, MutableRefObject } from 'react';
import { useConfigQuery } from '@api/apiSlice';
import { postCommitTelemetry } from '@features/builder/api/commitTelemetry';
import {
  BuilderStreamTimeoutError,
  streamBuilderDefinition,
} from '@features/builder/api/streamGenerate';
import {
  getBuilderMaxRepairAttempts,
  getBuilderMaxRepairValidationIssues,
  getBuilderRequestLimits,
  getBuilderSanitizedLlmRequestForTransport,
  getBuilderRuntimeConfigStatus,
  getBuilderStreamTimeouts,
  validateBuilderLlmRequest,
} from '@features/builder/config';
import {
  BuilderRequestAbortedError,
  isAbortError,
  useGenerationLifecycle,
} from './useGenerationLifecycle';
import { useStreamingSummary } from './useStreamingSummary';
import { OpenUiValidationError, useValidationRepair } from './useValidationRepair';
import { resolveBuilderComposerPrompt } from './submissionPrompt';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { resolveRuntimeConfigNotice } from '@features/builder/components/chatNotices';
import {
  selectDraftPrompt,
  selectRetryPrompt,
} from '@features/builder/store/selectors';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import type {
  BuilderChatNotice,
  BuilderGeneratedDraft,
  BuilderLlmRequest,
  BuilderLlmRequestCompaction,
  BuilderRequestId,
} from '@features/builder/types';
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
    return `The chat context was compacted to keep the earliest user request and the newest context, so ${omittedLabel} ${omittedVerb} omitted from this request.`;
  }

  return null;
}

interface UseBuilderSubmissionOptions {
  abortControllerRef: MutableRefObject<AbortController | null>;
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
}

export function useBuilderSubmission({ abortControllerRef, cancelActiveRequestRef, onSystemNotice }: UseBuilderSubmissionOptions) {
  const dispatch = useAppDispatch();
  const draftPrompt = useAppSelector(selectDraftPrompt);
  const retryPrompt = useAppSelector(selectRetryPrompt);
  const configState = useConfigQuery(undefined, {
    selectFromResult: ({ data, isError }) => ({
      data,
      isError,
    }),
  });
  const configStatus = getBuilderRuntimeConfigStatus(configState);
  const requestLimits = getBuilderRequestLimits(configState.data);
  const maxRepairAttempts = getBuilderMaxRepairAttempts(configState.data);
  const maxRepairValidationIssues = getBuilderMaxRepairValidationIssues(configState.data);
  const streamTimeouts = getBuilderStreamTimeouts(configState.data);
  const streamingSummary = useStreamingSummary();
  const generationLifecycle = useGenerationLifecycle({
    abortControllerRef,
    cancelActiveRequestRef,
    clearStreamingSummaryMessage: streamingSummary.clearStreamingSummaryMessage,
    onSystemNotice,
    streamMaxDurationMs: streamTimeouts?.streamMaxDurationMs ?? null,
  });
  const validationRepair = useValidationRepair({
    maxRepairAttempts,
    maxRepairValidationIssues,
    requestLimits,
    runGenerateRequest: generationLifecycle.runGenerateRequest,
    showStreamingSummaryStatus: streamingSummary.upsertStreamingStatusMessage,
    throwIfInactiveRequest: generationLifecycle.throwIfInactiveRequest,
  });

  function applyCompactionNotice(requestId: BuilderRequestId, compaction?: BuilderLlmRequestCompaction) {
    const compactionNotice = createCompactionNotice(compaction);

    if (!compactionNotice || !generationLifecycle.isActiveRequest(requestId)) {
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
    response: BuilderGeneratedDraft,
    request: BuilderLlmRequest,
    requestId: BuilderRequestId,
  ) {
    generationLifecycle.throwIfInactiveRequest(requestId);
    const validatedResult = await validationRepair.ensureValidGeneratedSource(response, request, requestId);
    generationLifecycle.throwIfInactiveRequest(requestId);
    const snapshot = createBuilderSnapshot(validatedResult.source, {}, store.getState().domain.data);
    const committedSummary = streamingSummary.getCommittedSummary(requestId, validatedResult.summary ?? response.summary);
    const committedSummaryExcludeFromLlmContext =
      validatedResult.summary !== undefined
        ? validatedResult.summaryExcludeFromLlmContext
        : response.summaryExcludeFromLlmContext;

    if (committedSummary) {
      streamingSummary.upsertStreamingSummaryMessage(requestId, committedSummary, {
        excludeFromLlmContext: committedSummaryExcludeFromLlmContext,
      });
    } else {
      streamingSummary.clearStreamingSummaryMessage(requestId);
    }

    applyCompactionNotice(requestId, response.compaction);
    generationLifecycle.throwIfInactiveRequest(requestId);
    dispatch(builderSessionActions.replaceRuntimeSessionState(snapshot.runtimeState));
    dispatch(
      builderActions.completeStreaming({
        requestId,
        source: validatedResult.source,
        note: validatedResult.note,
        skipDefaultAssistantMessage: Boolean(committedSummary),
        snapshot,
        warnings: validatedResult.warnings,
      }),
    );
    void postCommitTelemetry({
      commitSource: validatedResult.commitSource,
      committed: true,
      requestId: validatedResult.requestId,
      validationIssues: [],
    });
    generationLifecycle.completeGeneration(requestId);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = resolveBuilderComposerPrompt({
      draftPrompt,
      retryPrompt,
    });

    if (!nextPrompt || generationLifecycle.isSubmitting) {
      return;
    }

    if (
      configStatus !== 'loaded' ||
      requestLimits === null ||
      streamTimeouts === null ||
      maxRepairAttempts === null ||
      maxRepairValidationIssues === null
    ) {
      const runtimeConfigNotice = resolveRuntimeConfigNotice({
        configStatus,
        runtimeConfigStatusContent: null,
      });

      if (runtimeConfigNotice) {
        onSystemNotice(runtimeConfigNotice);
      }

      return;
    }

    const currentState = store.getState();
    const request: BuilderLlmRequest = {
      prompt: nextPrompt,
      currentSource: currentState.builder.committedSource,
      chatHistory: currentState.builder.chatMessages.map(({ content, excludeFromLlmContext, role }) => ({
        content,
        excludeFromLlmContext,
        role,
      })),
      mode: 'initial',
    };
    const transportRequest = getBuilderSanitizedLlmRequestForTransport(request, requestLimits);
    const requestValidationError = validateBuilderLlmRequest(transportRequest, requestLimits);

    if (requestValidationError) {
      onSystemNotice({
        content: requestValidationError,
        tone: 'error',
      });
      return;
    }

    let hasObservedStreamActivity = false;
    let hasCompletedStreamRequest = false;
    const { abortController, requestId } = generationLifecycle.beginGeneration(nextPrompt);

    try {
      const streamResult = await streamBuilderDefinition({
        apiBaseUrl: getBackendApiBaseUrl(),
        idleTimeoutMs: streamTimeouts.streamIdleTimeoutMs,
        maxDurationMs: streamTimeouts.streamMaxDurationMs,
        requestId,
        request: transportRequest,
        signal: abortController.signal,
        onChunk: (chunk) => {
          hasObservedStreamActivity = true;
          dispatch(builderActions.appendStreamChunk({ requestId, chunk }));
        },
        onSummary: (summary) => {
          if (!generationLifecycle.isActiveRequest(requestId)) {
            return;
          }

          hasObservedStreamActivity = true;
          streamingSummary.upsertStreamingSummaryMessage(requestId, summary, { pending: true });
        },
      });
      hasCompletedStreamRequest = true;

      await commitGeneratedSource(
        {
          ...streamResult,
          commitSource: 'streaming',
          requestId,
        },
        transportRequest,
        requestId,
      );
    } catch (error) {
      if (error instanceof BuilderStreamTimeoutError) {
        if (hasObservedStreamActivity && generationLifecycle.isActiveRequest(requestId)) {
          generationLifecycle.failRequest(requestId, error, { retryPrompt: request.prompt });
        }

        if (hasObservedStreamActivity) {
          return;
        }
      }

      if (
        isAbortError(error) ||
        error instanceof BuilderRequestAbortedError ||
        !generationLifecycle.isActiveRequest(requestId)
      ) {
        generationLifecycle.cancelRequest(requestId);
        return;
      }

      if (error instanceof OpenUiValidationError) {
        generationLifecycle.failRequest(requestId, error, { retryPrompt: request.prompt });
        return;
      }

      if (!hasCompletedStreamRequest && !hasObservedStreamActivity) {
        try {
          const fallbackResponse = await generationLifecycle.runGenerateRequest(requestId, transportRequest, {
            requestKind: 'stream-fallback',
          });
          await commitGeneratedSource(fallbackResponse, transportRequest, requestId);
          return;
        } catch (fallbackError) {
          if (fallbackError instanceof BuilderStreamTimeoutError) {
            if (generationLifecycle.isActiveRequest(requestId)) {
              generationLifecycle.failRequest(requestId, fallbackError, { retryPrompt: request.prompt });
            }

            return;
          }

          if (
            isAbortError(fallbackError) ||
            fallbackError instanceof BuilderRequestAbortedError ||
            !generationLifecycle.isActiveRequest(requestId)
          ) {
            generationLifecycle.cancelRequest(requestId);
            return;
          }

          generationLifecycle.failRequest(requestId, fallbackError, { retryPrompt: request.prompt });
          return;
        }
      }

      generationLifecycle.failRequest(requestId, error, { retryPrompt: request.prompt });
    } finally {
      generationLifecycle.finalizeGeneration(requestId, abortController);
    }
  }

  function handleDraftPromptChange(value: string) {
    dispatch(builderActions.setDraftPrompt(value));
  }

  return {
    configStatus,
    draftPrompt,
    handleDraftPromptChange,
    handleCancel: generationLifecycle.handleCancel,
    handleSubmit,
    isSubmitting: generationLifecycle.isSubmitting,
    promptMaxChars: requestLimits?.promptMaxChars,
    retryPrompt,
  };
}
