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
import { applyOpenUiIssueSuggestions, detectOpenUiQualityIssues, validateOpenUiSource } from '@features/builder/openui/runtime/validation';
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
import type {
  BuilderChatNotice,
  BuilderLlmRequest,
  BuilderLlmRequestCompaction,
  BuilderLlmResponse,
  BuilderParseIssue,
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
    return `The chat context was compacted to the most recent window, so ${omittedLabel} ${omittedVerb} omitted from this request.`;
  }

  return null;
}

interface UseBuilderSubmissionOptions {
  abortControllerRef: MutableRefObject<AbortController | null>;
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
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

function getStreamingSummaryMessageKey(requestId: BuilderRequestId) {
  return `generation-summary:${requestId}`;
}

function formatPendingSummary(summary: string) {
  const trimmedSummary = summary.trim();

  if (!trimmedSummary) {
    return '';
  }

  return `Building: ${trimmedSummary}${trimmedSummary.endsWith('…') ? '' : '…'}`;
}

function normalizeCommittedSummary(messageContent: string) {
  const trimmedContent = messageContent.trim();

  if (!trimmedContent.startsWith('Building: ')) {
    return trimmedContent;
  }

  const normalizedSummary = trimmedContent.slice('Building: '.length).trim();
  return normalizedSummary.endsWith('…') ? normalizedSummary.slice(0, -1).trim() : normalizedSummary;
}

function logLocalAutoFix(appliedIssues: BuilderParseIssue[]) {
  if (appliedIssues.length === 0) {
    return;
  }

  const appliedLabels = appliedIssues.map((issue) => `${issue.code}${issue.statementId ? ` in ${issue.statementId}` : ''}`);
  console.info(`[builder.validation] auto-fixed locally: ${appliedLabels.join(', ')}`);
}

const USER_CANCELLED_NOTICE = 'Cancelled the in-progress generation at your request.';

export function useBuilderSubmission({ abortControllerRef, cancelActiveRequestRef, onSystemNotice }: UseBuilderSubmissionOptions) {
  const dispatch = useAppDispatch();
  const activeRequestIdRef = useRef<BuilderRequestId | null>(null);
  const handleCancelRef = useRef<() => void>(() => {});
  const userCancelledRequestIdRef = useRef<BuilderRequestId | null>(null);
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

  function clearStreamingSummaryMessage(requestId: BuilderRequestId) {
    dispatch(
      builderActions.removeChatMessageByKey({
        messageKey: getStreamingSummaryMessageKey(requestId),
      }),
    );
  }

  function getCommittedSummary(requestId: BuilderRequestId, summary?: string) {
    const trimmedSummary = typeof summary === 'string' ? summary.trim() : '';

    if (trimmedSummary) {
      return trimmedSummary;
    }

    const pendingSummaryMessage = store
      .getState()
      .builder.chatMessages.find((message) => message.messageKey === getStreamingSummaryMessageKey(requestId));

    if (!pendingSummaryMessage) {
      return '';
    }

    return normalizeCommittedSummary(pendingSummaryMessage.content);
  }

  function consumeUserCancelledRequest(requestId: BuilderRequestId) {
    if (userCancelledRequestIdRef.current !== requestId) {
      return false;
    }

    userCancelledRequestIdRef.current = null;
    return true;
  }

  function upsertStreamingSummaryMessage(requestId: BuilderRequestId, summary: string, options?: { pending?: boolean }) {
    const trimmedSummary = summary.trim();

    if (!trimmedSummary) {
      return;
    }

    dispatch(
      builderActions.appendChatMessage({
        content: options?.pending ? formatPendingSummary(trimmedSummary) : trimmedSummary,
        messageKey: getStreamingSummaryMessageKey(requestId),
        role: 'assistant',
      }),
    );
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

  async function runGenerateRequest(requestId: BuilderRequestId, request: BuilderLlmRequest) {
    throwIfInactiveRequest(requestId);

    return generateBuilderDefinition({
      apiBaseUrl: getBackendApiBaseUrl(),
      request,
      signal: abortControllerRef.current?.signal,
      timeoutMs: streamTimeouts.streamMaxDurationMs,
    });
  }

  async function ensureValidGeneratedSource(
    initialResponse: Pick<BuilderLlmResponse, 'notes' | 'source' | 'summary'>,
    request: BuilderLlmRequest,
    requestId: BuilderRequestId,
  ) {
    let candidateResponse: Pick<BuilderLlmResponse, 'notes' | 'source' | 'summary'> = {
      notes: initialResponse.notes,
      source: initialResponse.source,
      summary: initialResponse.summary,
    };
    let parserRepairCount = 0;
    let qualityRepairCount = 0;
    let hasAnnouncedRepair = false;
    let hasCompletedRepairRequest = false;

    function buildRepairNote() {
      if (parserRepairCount > 0 && qualityRepairCount > 0) {
        return 'The first draft had parser issues and blocking quality issues, so it was repaired automatically before commit.';
      }

      if (parserRepairCount > 0) {
        return 'The first draft had parser issues, so it was repaired automatically before commit.';
      }

      if (qualityRepairCount > 0) {
        return 'The first draft had blocking quality issues, so it was repaired automatically before commit.';
      }

      return undefined;
    }

    async function runRepairRequest(issues: Parameters<typeof buildRepairPrompt>[0]['issues'], attemptNumber: number) {
      const repairRequest: BuilderLlmRequest = {
        prompt: buildRepairPrompt({
          userPrompt: request.prompt,
          committedSource: request.currentSource,
          invalidSource: candidateResponse.source,
          issues,
          attemptNumber,
          promptMaxChars: requestLimits.promptMaxChars,
        }),
        currentSource: request.currentSource,
        chatHistory: request.chatHistory,
        mode: 'repair',
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
            content: 'The model returned a draft that cannot be committed yet. Sending one automatic repair request now.',
          }),
        );
        hasAnnouncedRepair = true;
      }

      const repairedResponse = await runGenerateRequest(requestId, repairRequest);
      throwIfInactiveRequest(requestId);
      hasCompletedRepairRequest = true;
      candidateResponse = {
        notes: repairedResponse.notes,
        source: repairedResponse.source,
        summary: repairedResponse.summary,
      };
    }

    while (true) {
      const validation = validateOpenUiSource(candidateResponse.source);

      if (!validation.isValid) {
        const autoFixResult = applyOpenUiIssueSuggestions(candidateResponse.source, validation.issues);

        if (autoFixResult.appliedIssues.length > 0 && autoFixResult.source !== candidateResponse.source) {
          candidateResponse = {
            ...candidateResponse,
            source: autoFixResult.source,
          };
          logLocalAutoFix(autoFixResult.appliedIssues);
          continue;
        }
      }

      if (validation.isValid) {
        const qualityIssues = detectOpenUiQualityIssues(candidateResponse.source, request.prompt);
        const fatalQualityIssues = qualityIssues.filter((issue) => issue.severity === 'fatal-quality');
        const blockingQualityIssues = qualityIssues.filter((issue) => issue.severity === 'blocking-quality');
        const qualityWarnings = qualityIssues
          .filter((issue) => issue.severity === 'soft-warning')
          .map(({ severity, ...issue }) => {
            void severity;
            return issue;
          });

        if (fatalQualityIssues.length > 0) {
            throw new OpenUiValidationError(
              createValidationFailureMessage(
                fatalQualityIssues.map(({ severity, ...issue }) => {
                  void severity;
                  return issue;
                }),
                parserRepairCount + qualityRepairCount,
              ),
            );
        }

        if (blockingQualityIssues.length > 0) {
          if (qualityRepairCount >= 1) {
            throw new OpenUiValidationError(
              createValidationFailureMessage(
                blockingQualityIssues.map(({ severity, ...issue }) => {
                  void severity;
                  return issue;
                }),
                parserRepairCount + qualityRepairCount,
              ),
            );
          }

          qualityRepairCount += 1;
          await runRepairRequest(
            blockingQualityIssues.map(({ severity, ...issue }) => {
              void severity;
              return issue;
            }),
            qualityRepairCount,
          );
          continue;
        }

        return {
          note: hasCompletedRepairRequest ? buildRepairNote() : undefined,
          notes: candidateResponse.notes,
          source: candidateResponse.source,
          summary: candidateResponse.summary,
          warnings: qualityWarnings,
        };
      }

      if (parserRepairCount >= MAX_AUTO_REPAIR_ATTEMPTS) {
        throw new OpenUiValidationError(createValidationFailureMessage(validation.issues, parserRepairCount + qualityRepairCount));
      }

      parserRepairCount += 1;
      await runRepairRequest(validation.issues, parserRepairCount);
    }
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
    response: Pick<BuilderLlmResponse, 'compaction' | 'notes' | 'source' | 'summary'>,
    request: BuilderLlmRequest,
    requestId: BuilderRequestId,
  ) {
    throwIfInactiveRequest(requestId);
    const validatedResult = await ensureValidGeneratedSource(response, request, requestId);
    throwIfInactiveRequest(requestId);
    const snapshot = createBuilderSnapshot(validatedResult.source, {}, domainData);
    const committedSummary = getCommittedSummary(requestId, validatedResult.summary ?? response.summary);

    if (committedSummary) {
      upsertStreamingSummaryMessage(requestId, committedSummary);
    }

    applyCompactionNotice(requestId, response.compaction);
    throwIfInactiveRequest(requestId);
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
    clearRequestHandles(requestId);
    clearActiveRequest(requestId);
  }

  handleCancelRef.current = () => {
    const requestId = activeRequestIdRef.current;

    if (!requestId) {
      return;
    }

    onSystemNotice(null);
    cancelRequest(requestId, { abort: true });
  };

  const handleCancel = useCallback(() => {
    const requestId = activeRequestIdRef.current;

    if (requestId) {
      userCancelledRequestIdRef.current = requestId;
    }

    handleCancelRef.current();
  }, []);

  useEffect(() => {
    cancelActiveRequestRef.current = () => {
      handleCancelRef.current();
    };
  }, [cancelActiveRequestRef]);

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
      mode: 'initial',
    };
    const requestValidationError = validateBuilderLlmRequest(request, requestLimits);

    if (requestValidationError) {
      onSystemNotice({
        content: requestValidationError,
        tone: 'error',
      });
      return;
    }

    let receivedChunk = false;
    const requestId = createRequestId();
    const previousRequestId = activeRequestIdRef.current;
    onSystemNotice(null);
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
        onSummary: (summary) => {
          if (!isActiveRequest(requestId)) {
            return;
          }

          upsertStreamingSummaryMessage(requestId, summary, { pending: true });
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

      if (error instanceof OpenUiValidationError) {
        failRequest(requestId, error, { retryPrompt: request.prompt });
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
