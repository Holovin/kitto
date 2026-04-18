import type { FormEvent, MutableRefObject } from 'react';
import { useConfigQuery, useGenerateAppMutation } from '@api/apiSlice';
import { getBuilderRequestErrorMessage } from '@features/builder/api/requestErrors';
import { streamBuilderDefinition } from '@features/builder/api/streamGenerate';
import { getBuilderRequestLimits, validateBuilderLlmRequest } from '@features/builder/config';
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
  BuilderChatMessage,
  BuilderLlmRequest,
  BuilderLlmRequestCompaction,
  BuilderLlmResponse,
  BuilderParseIssue,
} from '@features/builder/types';
import { getBackendApiBaseUrl } from '@helpers/environment';
import { useAppDispatch, useAppSelector } from '@store/hooks';

const MAX_AUTO_REPAIR_ATTEMPTS = 2;

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

function buildRepairPrompt(userPrompt: string, issues: BuilderParseIssue[], attemptNumber: number, promptMaxChars: number) {
  const maxUserPromptChars = Math.max(256, Math.floor(promptMaxChars * 0.35));
  const sections = [
    `The previous OpenUI draft is invalid. Repair attempt ${attemptNumber}.`,
    `Original user request:\n${truncateText(userPrompt, maxUserPromptChars)}`,
    'Fix every validation issue below and return a complete corrected program.',
  ];
  const constraintSection = [
    'Important constraints:',
    '- Do not leave unresolved references.',
    '- Every @Run(statementId) must reference a defined Query or Mutation statement.',
    '- If a Mutation changes data that is rendered through a Query, call @Run(theQueryStatement) after the mutation so the preview refreshes immediately.',
    '- Preserve the intended UI and behavior unless a broken part must be rewritten to become valid.',
    '- Return only raw OpenUI Lang source.',
  ].join('\n');
  const selectedIssueLines: string[] = [];

  for (const issue of issues) {
    const nextIssueLines = [...selectedIssueLines, `- ${formatValidationIssue(issue)}`];
    const candidatePrompt = [...sections, nextIssueLines.join('\n'), constraintSection].filter(Boolean).join('\n\n');

    if (candidatePrompt.length > promptMaxChars) {
      break;
    }

    selectedIssueLines.push(`- ${formatValidationIssue(issue)}`);
  }

  if (!selectedIssueLines.length && issues[0]) {
    selectedIssueLines.push(`- ${truncateText(formatValidationIssue(issues[0]), 240)}`);
  }

  return truncateText([...sections, selectedIssueLines.join('\n'), constraintSection].filter(Boolean).join('\n\n'), promptMaxChars);
}

function createValidationFailureMessage(issues: BuilderParseIssue[]) {
  const summary = issues.slice(0, 3).map(formatValidationIssue).join(' | ');
  return `The model kept returning invalid OpenUI after automatic repair. ${summary || 'Please try again.'}`;
}

function buildRequestChatHistory(messages: BuilderChatMessage[], maxItems: number) {
  return messages
    .filter((message) => !(message.role === 'system' && message.tone === 'info'))
    .slice(-maxItems)
    .map(({ content, role }) => ({ content, role }));
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
  onFeedbackChange: (message: string | null) => void;
}

export function useBuilderSubmission({ abortControllerRef, onFeedbackChange }: UseBuilderSubmissionOptions) {
  const dispatch = useAppDispatch();
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
  const [generateApp, generateState] = useGenerateAppMutation();
  const isSubmitting = isStreaming || generateState.isLoading;

  async function ensureValidGeneratedSource(initialSource: string, request: BuilderLlmRequest) {
    let candidateSource = initialSource;
    let attempt = 0;
    let hasAnnouncedRepair = false;

    while (attempt <= MAX_AUTO_REPAIR_ATTEMPTS) {
      const validation = validateOpenUiSource(candidateSource);

      if (validation.isValid) {
        return {
          note: hasAnnouncedRepair ? 'The first draft had parser issues, so it was repaired automatically before commit.' : undefined,
          source: candidateSource,
        };
      }

      if (!hasAnnouncedRepair) {
        dispatch(
          builderActions.appendChatMessage({
            role: 'system',
            tone: 'info',
            content: 'The model returned an invalid draft. Sending it back for automatic repair now.',
          }),
        );
        hasAnnouncedRepair = true;
      }

      attempt += 1;

      if (attempt > MAX_AUTO_REPAIR_ATTEMPTS) {
        throw new Error(createValidationFailureMessage(validation.issues));
      }

      const repairRequest: BuilderLlmRequest = {
        prompt: buildRepairPrompt(request.prompt, validation.issues, attempt, requestLimits.promptMaxChars),
        currentSource: candidateSource,
        chatHistory: request.chatHistory,
      };
      const repairRequestValidationError = validateBuilderLlmRequest(repairRequest, requestLimits);

      if (repairRequestValidationError) {
        throw new Error(repairRequestValidationError);
      }

      const repairedResponse = await generateApp(repairRequest).unwrap();
      candidateSource = repairedResponse.source;
    }

    return {
      source: candidateSource,
    };
  }

  function applyCompactionNotice(compaction?: BuilderLlmRequestCompaction) {
    const compactionNotice = createCompactionNotice(compaction);

    if (!compactionNotice) {
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
  ) {
    const validatedResult = await ensureValidGeneratedSource(response.source, request);
    const snapshot = createBuilderSnapshot(validatedResult.source, {}, domainData);

    applyCompactionNotice(response.compaction);
    dispatch(builderSessionActions.replaceRuntimeSessionState(snapshot.runtimeState));
    dispatch(
      builderActions.completeStreaming({
        source: validatedResult.source,
        note: validatedResult.note,
        snapshot,
      }),
    );
  }

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
    onFeedbackChange(null);
    dispatch(builderActions.beginStreaming({ prompt: nextPrompt }));

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const streamResult = await streamBuilderDefinition({
        apiBaseUrl: getBackendApiBaseUrl(),
        request,
        signal: abortController.signal,
        onChunk: (chunk) => {
          receivedChunk = true;
          dispatch(builderActions.appendStreamChunk(chunk));
        },
      });

      await commitGeneratedSource(streamResult, request);
    } catch (error) {
      if (!receivedChunk) {
        try {
          const fallbackResponse = await generateApp(request).unwrap();
          await commitGeneratedSource(fallbackResponse, request);
          return;
        } catch (fallbackError) {
          dispatch(
            builderActions.failStreaming({
              message: getBuilderRequestErrorMessage(fallbackError),
            }),
          );
          return;
        }
      }

      dispatch(
        builderActions.failStreaming({
          message: getBuilderRequestErrorMessage(error),
        }),
      );
    } finally {
      abortControllerRef.current = null;
    }
  }

  function handleDraftPromptChange(value: string) {
    dispatch(builderActions.setDraftPrompt(value));
  }

  return {
    draftPrompt,
    handleDraftPromptChange,
    handleSubmit,
    isSubmitting,
    promptMaxChars: requestLimits.promptMaxChars,
  };
}
