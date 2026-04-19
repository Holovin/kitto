import { nanoid } from '@reduxjs/toolkit';
import { useCallback, useEffect, useRef, type FormEvent, type MutableRefObject } from 'react';
import { useConfigQuery, useGenerateAppMutation } from '@api/apiSlice';
import { getBuilderRequestErrorMessage } from '@features/builder/api/requestErrors';
import { unwrapAbortableRequestWithTimeout } from '@features/builder/api/requestTimeout';
import {
  BuilderStreamTimeoutError,
  streamBuilderDefinition,
  type BuilderStreamTimeoutKind,
} from '@features/builder/api/streamGenerate';
import { getBuilderRequestLimits, getBuilderStreamTimeouts, validateBuilderLlmRequest } from '@features/builder/config';
import { buildRequestChatHistory } from '@features/builder/hooks/requestChatHistory';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { validateOpenUiSource } from '@features/builder/openui/runtime/validation';
import {
  selectChatMessages,
  selectCommittedSource,
  selectDomainData,
  selectDraftPrompt,
  selectIsStreaming,
} from '@features/builder/store/selectors';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import type {
  BuilderLlmRequest,
  BuilderLlmRequestCompaction,
  BuilderLlmResponse,
  BuilderParseIssue,
  BuilderRequestId,
} from '@features/builder/types';
import { getBackendApiBaseUrl } from '@helpers/environment';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { store } from '@store/store';

const MAX_AUTO_REPAIR_ATTEMPTS = 1;
const REPAIR_CRITICAL_RULES = [
  'Return only raw OpenUI Lang.',
  'Return the full updated program.',
  'Use only supported components and tools.',
  'Every @Run(ref) must reference a defined Query or Mutation.',
  'Screen signature is Screen(id, title, children, isActive?).',
  'Use $currentScreen + @Set for screen navigation.',
  'Button signature is Button(id, label, variant, action?, disabled?).',
] as const;

function formatValidationIssue(issue: BuilderParseIssue) {
  return `${issue.code}${issue.statementId ? ` in ${issue.statementId}` : ''}: ${issue.message}`;
}

function truncateText(value: string, maxChars: number) {
  if (maxChars <= 0) {
    return '';
  }

  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function buildRepairSection(title: string, content: string) {
  return `${title}:\n${content}`;
}

function buildRepairSourceSectionContent(value: string, maxChars: number, fallback: string) {
  if (maxChars <= 0) {
    return fallback;
  }

  return value.trim() ? truncateText(value, maxChars) : fallback;
}

function allocateRepairSectionBudgets(totalChars: number) {
  const sectionKeys = ['userPrompt', 'committedSource', 'invalidSource', 'issues'] as const;
  const minimumBudgets = {
    userPrompt: 120,
    committedSource: 180,
    invalidSource: 300,
    issues: 200,
  } as const;
  const weights = {
    userPrompt: 1,
    committedSource: 1.2,
    invalidSource: 2.8,
    issues: 1.6,
  } as const;
  const budgets = {
    userPrompt: 0,
    committedSource: 0,
    invalidSource: 0,
    issues: 0,
  };

  if (totalChars <= 0) {
    return budgets;
  }

  const minimumTotal = sectionKeys.reduce((sum, key) => sum + minimumBudgets[key], 0);
  const totalWeight = sectionKeys.reduce((sum, key) => sum + weights[key], 0);

  if (totalChars <= minimumTotal) {
    let allocated = 0;

    for (const key of sectionKeys) {
      const nextBudget = Math.floor((totalChars * weights[key]) / totalWeight);
      budgets[key] = nextBudget;
      allocated += nextBudget;
    }

    let remainder = totalChars - allocated;

    for (const key of ['invalidSource', 'issues', 'committedSource', 'userPrompt'] as const) {
      if (remainder <= 0) {
        break;
      }

      budgets[key] += 1;
      remainder -= 1;
    }

    return budgets;
  }

  let allocated = minimumTotal;

  for (const key of sectionKeys) {
    budgets[key] = minimumBudgets[key];
  }

  const remainingChars = totalChars - minimumTotal;

  for (const key of sectionKeys) {
    const extraBudget = Math.floor((remainingChars * weights[key]) / totalWeight);
    budgets[key] += extraBudget;
    allocated += extraBudget;
  }

  let remainder = totalChars - allocated;

  for (const key of ['invalidSource', 'issues', 'committedSource', 'userPrompt'] as const) {
    if (remainder <= 0) {
      break;
    }

    budgets[key] += 1;
    remainder -= 1;
  }

  return budgets;
}

function buildRepairIssueSection(issues: BuilderParseIssue[], maxChars: number) {
  if (maxChars <= 0) {
    return '- Validation issues were detected, but they could not be enumerated in full.';
  }

  const selectedIssueLines: string[] = [];

  for (const issue of issues) {
    const nextLine = `- ${formatValidationIssue(issue)}`;
    const candidateSection = [...selectedIssueLines, nextLine].join('\n');

    if (candidateSection.length > maxChars) {
      break;
    }

    selectedIssueLines.push(nextLine);
  }

  if (!selectedIssueLines.length && issues[0]) {
    selectedIssueLines.push(`- ${truncateText(formatValidationIssue(issues[0]), Math.max(1, maxChars - 2))}`);
  }

  return selectedIssueLines.length ? selectedIssueLines.join('\n') : '- Validation issues were detected, but they could not be enumerated in full.';
}

function buildRepairPrompt(args: {
  userPrompt: string;
  committedSource: string;
  invalidSource: string;
  issues: BuilderParseIssue[];
  attemptNumber: number;
  promptMaxChars: number;
}) {
  const { attemptNumber, committedSource, invalidSource, issues, promptMaxChars, userPrompt } = args;
  const introSection = [
    `The previous OpenUI draft is invalid. Automatic repair attempt ${attemptNumber} of ${MAX_AUTO_REPAIR_ATTEMPTS}.`,
    'Use the current committed valid OpenUI source as the baseline for this request.',
    'Carry forward the intended changes from the invalid model draft only when they can be expressed as valid OpenUI.',
    'Fix every validation issue below and return a complete corrected program.',
  ].join('\n');
  const rulesSection = REPAIR_CRITICAL_RULES.map((rule) => `- ${rule}`).join('\n');
  const sectionHeaders = [
    'Original user request:',
    'Current committed valid OpenUI source:',
    'Invalid model draft:',
    'Validation issues:',
    'Current critical syntax rules:',
  ];
  const fixedChars =
    introSection.length +
    rulesSection.length +
    sectionHeaders.reduce((sum, header) => sum + header.length + 1, 0) +
    10;
  const budgets = allocateRepairSectionBudgets(promptMaxChars - fixedChars);

  return truncateText(
    [
      introSection,
      buildRepairSection('Original user request', buildRepairSourceSectionContent(userPrompt, budgets.userPrompt, '(empty user request)')),
      buildRepairSection(
        'Current committed valid OpenUI source',
        buildRepairSourceSectionContent(committedSource, budgets.committedSource, '(blank canvas, no committed OpenUI source yet)'),
      ),
      buildRepairSection('Invalid model draft', buildRepairSourceSectionContent(invalidSource, budgets.invalidSource, '(the invalid draft was empty)')),
      buildRepairSection('Validation issues', buildRepairIssueSection(issues, budgets.issues)),
      buildRepairSection('Current critical syntax rules', rulesSection),
    ].join('\n\n'),
    promptMaxChars,
  );
}

function createValidationFailureMessage(issues: BuilderParseIssue[]) {
  const summary = issues.slice(0, 3).map(formatValidationIssue).join(' | ');
  const repairAttemptLabel =
    MAX_AUTO_REPAIR_ATTEMPTS === 1 ? '1 automatic repair attempt' : `${MAX_AUTO_REPAIR_ATTEMPTS} automatic repair attempts`;

  return `The model kept returning invalid OpenUI after ${repairAttemptLabel}. ${summary || 'Please try again.'}`;
}

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
  issues: BuilderParseIssue[];
  source: string;

  constructor(message: string, source: string, issues: BuilderParseIssue[]) {
    super(message);
    this.name = 'OpenUiValidationError';
    this.source = source;
    this.issues = issues;
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
  const activeMutationAbortRef = useRef<(() => void) | null>(null);
  const handleCancelRef = useRef<() => void>(() => {});
  const chatMessages = useAppSelector(selectChatMessages);
  const committedSource = useAppSelector(selectCommittedSource);
  const domainData = useAppSelector(selectDomainData);
  const draftPrompt = useAppSelector(selectDraftPrompt);
  const isStreaming = useAppSelector(selectIsStreaming);
  const configState = useConfigQuery(undefined, {
    selectFromResult: ({ data }) => ({
      data,
    }),
  });
  const requestLimits = getBuilderRequestLimits(configState.data);
  const streamTimeouts = getBuilderStreamTimeouts(configState.data);
  const [generateApp] = useGenerateAppMutation();
  const isSubmitting = isStreaming;

  useEffect(() => {
    return () => {
      activeRequestIdRef.current = null;
      activeMutationAbortRef.current = null;
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
    activeMutationAbortRef.current = null;
  }

  function abortRequestHandles(requestId: BuilderRequestId) {
    if (activeRequestIdRef.current !== requestId) {
      return;
    }

    const abortController = abortControllerRef.current;
    const abortMutation = activeMutationAbortRef.current;

    abortControllerRef.current = null;
    activeMutationAbortRef.current = null;
    abortController?.abort();
    abortMutation?.();
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

  function failRequest(requestId: BuilderRequestId, error: unknown, options?: { abort?: boolean }) {
    if (options?.abort) {
      abortRequestHandles(requestId);
    } else {
      clearRequestHandles(requestId);
    }

    clearActiveRequest(requestId);
    dispatch(
      builderActions.failStreaming({
        requestId,
        issues: error instanceof OpenUiValidationError ? error.issues : undefined,
        message: getBuilderRequestErrorMessage(error),
        source: error instanceof OpenUiValidationError ? error.source : undefined,
      }),
    );
  }

  function handleStreamTimeout(requestId: BuilderRequestId, kind: BuilderStreamTimeoutKind) {
    if (!isActiveRequest(requestId)) {
      return;
    }

    failRequest(requestId, new BuilderStreamTimeoutError(kind), { abort: true });
  }

  async function runGenerateRequest(requestId: BuilderRequestId, request: BuilderLlmRequest) {
    const generateRequest = generateApp(request);
    const abortGenerateRequest = () => generateRequest.abort();

    if (isActiveRequest(requestId)) {
      activeMutationAbortRef.current = abortGenerateRequest;
    }

    try {
      return await unwrapAbortableRequestWithTimeout(generateRequest, streamTimeouts.streamMaxDurationMs);
    } finally {
      if (activeRequestIdRef.current === requestId && activeMutationAbortRef.current === abortGenerateRequest) {
        activeMutationAbortRef.current = null;
      }
    }
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
        throw new OpenUiValidationError(createValidationFailureMessage(validation.issues), candidateSource, validation.issues);
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
    const nextPrompt = draftPrompt.trim();

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
          handleStreamTimeout(requestId, kind);
        },
      });

      await commitGeneratedSource(streamResult, request, requestId);
    } catch (error) {
      if (error instanceof BuilderStreamTimeoutError) {
        if (isActiveRequest(requestId)) {
          failRequest(requestId, error);
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
              failRequest(requestId, fallbackError);
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

          failRequest(requestId, fallbackError);
          return;
        }
      }

      failRequest(requestId, error);
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
  };
}
