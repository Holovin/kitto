import { postCommitTelemetry } from '@features/builder/api/commitTelemetry';
import {
  BuilderStreamTimeoutError,
  streamBuilderDefinition,
} from '@features/builder/api/streamGenerate';
import type { BuilderStreamTimeouts } from '@features/builder/config';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import type {
  BuilderGeneratedDraft,
  PromptBuildRequest,
  BuilderLlmRequestCompaction,
  PromptBuildValidationIssue,
  BuilderRequestId,
} from '@features/builder/types';
import type { AppDispatch } from '@store/store';
import { BuilderRequestAbortedError, isAbortError } from './useGenerationLifecycle';
import { OpenUiValidationError } from './useValidationRepair';

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

type BuilderGenerationPhase = 'streaming' | 'fallback' | 'committing' | 'completed' | 'cancelled' | 'failed';

interface BuilderGenerationMachineState {
  completedStreamRequest: boolean;
  observedStreamActivity: boolean;
  phase: BuilderGenerationPhase;
}

function createInitialGenerationState(): BuilderGenerationMachineState {
  return {
    completedStreamRequest: false,
    observedStreamActivity: false,
    phase: 'streaming',
  };
}

function transitionGenerationState(
  state: BuilderGenerationMachineState,
  patch: Partial<BuilderGenerationMachineState>,
): BuilderGenerationMachineState {
  return {
    ...state,
    ...patch,
  };
}

interface BuilderGenerationLifecyclePort {
  cancelRequest: (requestId: BuilderRequestId) => void;
  completeGeneration: (requestId: BuilderRequestId) => void;
  failRequest: (requestId: BuilderRequestId, error: unknown, options?: { abort?: boolean; retryPrompt?: string | null }) => void;
  finalizeGeneration: (requestId: BuilderRequestId, abortController: AbortController) => void;
  isActiveRequest: (requestId: BuilderRequestId) => boolean;
  runGenerateRequest: (
    requestId: BuilderRequestId,
    request: PromptBuildRequest,
    options?: { requestKind?: 'automatic-repair' | 'stream-fallback'; transportRequestId?: BuilderRequestId },
  ) => Promise<BuilderGeneratedDraft>;
  throwIfInactiveRequest: (requestId: BuilderRequestId) => void;
}

interface BuilderStreamingSummaryPort {
  clearStreamingSummaryMessage: (requestId: BuilderRequestId) => void;
  getCommittedSummary: (requestId: BuilderRequestId, fallbackSummary?: string) => string | undefined;
  upsertStreamingSummaryMessage: (
    requestId: BuilderRequestId,
    summary: string,
    options?: { excludeFromLlmContext?: boolean; pending?: boolean },
  ) => void;
}

interface BuilderValidationRepairPort {
  ensureValidGeneratedSource: (
    initialResponse: BuilderGeneratedDraft,
    request: PromptBuildRequest,
    requestId: BuilderRequestId,
  ) => Promise<{
    commitSource: BuilderGeneratedDraft['commitSource'];
    note?: string;
    requestId: BuilderRequestId;
    source: string;
    summary?: string;
    summaryExcludeFromLlmContext?: boolean;
    warnings: PromptBuildValidationIssue[];
  }>;
}

interface RunBuilderGenerationOptions {
  abortController: AbortController;
  apiBaseUrl: string;
  dispatch: AppDispatch;
  getDomainData: () => Record<string, unknown>;
  lifecycle: BuilderGenerationLifecyclePort;
  request: PromptBuildRequest;
  requestId: BuilderRequestId;
  streamTimeouts: BuilderStreamTimeouts;
  streamingSummary: BuilderStreamingSummaryPort;
  transportRequest: PromptBuildRequest;
  validationRepair: BuilderValidationRepairPort;
}

function applyCompactionNotice({
  compaction,
  dispatch,
  lifecycle,
  requestId,
}: {
  compaction?: BuilderLlmRequestCompaction;
  dispatch: AppDispatch;
  lifecycle: BuilderGenerationLifecyclePort;
  requestId: BuilderRequestId;
}) {
  const compactionNotice = createCompactionNotice(compaction);

  if (!compactionNotice || !lifecycle.isActiveRequest(requestId)) {
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

async function commitGeneratedSource({
  dispatch,
  getDomainData,
  lifecycle,
  request,
  requestId,
  response,
  streamingSummary,
  validationRepair,
}: {
  dispatch: AppDispatch;
  getDomainData: () => Record<string, unknown>;
  lifecycle: BuilderGenerationLifecyclePort;
  request: PromptBuildRequest;
  requestId: BuilderRequestId;
  response: BuilderGeneratedDraft;
  streamingSummary: BuilderStreamingSummaryPort;
  validationRepair: BuilderValidationRepairPort;
}) {
  lifecycle.throwIfInactiveRequest(requestId);
  const validatedResult = await validationRepair.ensureValidGeneratedSource(response, request, requestId);
  lifecycle.throwIfInactiveRequest(requestId);
  const snapshot = createBuilderSnapshot(validatedResult.source, {}, getDomainData());
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

  applyCompactionNotice({
    compaction: response.compaction,
    dispatch,
    lifecycle,
    requestId,
  });
  lifecycle.throwIfInactiveRequest(requestId);
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
  postCommitTelemetry({
    commitSource: validatedResult.commitSource,
    committed: true,
    qualityWarnings: [...new Set(validatedResult.warnings.map((warning) => warning.code))],
    requestId: validatedResult.requestId,
    validationIssues: [],
  });
  lifecycle.completeGeneration(requestId);
}

export async function runBuilderGeneration({
  abortController,
  apiBaseUrl,
  dispatch,
  getDomainData,
  lifecycle,
  request,
  requestId,
  streamTimeouts,
  streamingSummary,
  transportRequest,
  validationRepair,
}: RunBuilderGenerationOptions) {
  let state = createInitialGenerationState();

  try {
    const streamResult = await streamBuilderDefinition({
      apiBaseUrl,
      idleTimeoutMs: streamTimeouts.streamIdleTimeoutMs,
      maxDurationMs: streamTimeouts.streamMaxDurationMs,
      requestId,
      request: transportRequest,
      signal: abortController.signal,
      onChunk: (chunk) => {
        state = transitionGenerationState(state, {
          observedStreamActivity: true,
        });
        dispatch(builderActions.appendStreamChunk({ requestId, chunk }));
      },
      onSummary: (summary) => {
        if (!lifecycle.isActiveRequest(requestId)) {
          return;
        }

        state = transitionGenerationState(state, {
          observedStreamActivity: true,
        });
        streamingSummary.upsertStreamingSummaryMessage(requestId, summary, { pending: true });
      },
    });
    state = transitionGenerationState(state, {
      completedStreamRequest: true,
      phase: 'committing',
    });

    await commitGeneratedSource({
      dispatch,
      getDomainData,
      lifecycle,
      request: transportRequest,
      requestId,
      response: {
        ...streamResult,
        commitSource: 'streaming',
        requestId,
      },
      streamingSummary,
      validationRepair,
    });
    state = transitionGenerationState(state, { phase: 'completed' });
  } catch (error) {
    if (error instanceof BuilderStreamTimeoutError) {
      if (state.observedStreamActivity) {
        if (lifecycle.isActiveRequest(requestId)) {
          lifecycle.failRequest(requestId, error, { retryPrompt: request.prompt });
        }

        state = transitionGenerationState(state, { phase: 'failed' });
        return;
      }
    }

    if (isAbortError(error) || error instanceof BuilderRequestAbortedError || !lifecycle.isActiveRequest(requestId)) {
      lifecycle.cancelRequest(requestId);
      state = transitionGenerationState(state, { phase: 'cancelled' });
      return;
    }

    if (error instanceof OpenUiValidationError) {
      lifecycle.failRequest(requestId, error, { retryPrompt: request.prompt });
      state = transitionGenerationState(state, { phase: 'failed' });
      return;
    }

    if (!state.completedStreamRequest && !state.observedStreamActivity) {
      state = transitionGenerationState(state, { phase: 'fallback' });

      try {
        const fallbackResponse = await lifecycle.runGenerateRequest(requestId, transportRequest, {
          requestKind: 'stream-fallback',
        });
        state = transitionGenerationState(state, { phase: 'committing' });
        await commitGeneratedSource({
          dispatch,
          getDomainData,
          lifecycle,
          request: transportRequest,
          requestId,
          response: fallbackResponse,
          streamingSummary,
          validationRepair,
        });
        state = transitionGenerationState(state, { phase: 'completed' });
        return;
      } catch (fallbackError) {
        if (fallbackError instanceof BuilderStreamTimeoutError) {
          if (lifecycle.isActiveRequest(requestId)) {
            lifecycle.failRequest(requestId, fallbackError, { retryPrompt: request.prompt });
          }

          state = transitionGenerationState(state, { phase: 'failed' });
          return;
        }

        if (
          isAbortError(fallbackError) ||
          fallbackError instanceof BuilderRequestAbortedError ||
          !lifecycle.isActiveRequest(requestId)
        ) {
          lifecycle.cancelRequest(requestId);
          state = transitionGenerationState(state, { phase: 'cancelled' });
          return;
        }

        lifecycle.failRequest(requestId, fallbackError, { retryPrompt: request.prompt });
        state = transitionGenerationState(state, { phase: 'failed' });
        return;
      }
    }

    lifecycle.failRequest(requestId, error, { retryPrompt: request.prompt });
    state = transitionGenerationState(state, { phase: 'failed' });
  } finally {
    lifecycle.finalizeGeneration(requestId, abortController);
  }
}
