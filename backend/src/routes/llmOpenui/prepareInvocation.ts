import {
  HISTORY_SUMMARY_MAX_CHARS,
  PREVIOUS_CHANGE_SUMMARIES_MAX_ITEMS,
  PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS,
  PREVIOUS_USER_MESSAGES_MAX_ITEMS,
  PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS,
  type PromptBuildRequest,
} from '@kitto-openui/shared/builderApiContract.js';
import type { AppEnv } from '#backend/env.js';
import { RequestValidationError } from '#backend/errors/publicError.js';
import { generateHistorySummary } from '#backend/services/openai.js';
import type { IntakeFailureRecorder } from './telemetry.js';
import { getLlmRequestSizeBytes, type PreparedLlmInvocation } from './requestSchema.js';

export type LlmInvocationStatus = 'compacting-history';

interface PrepareLlmInvocationOptions {
  onStatus?: (status: LlmInvocationStatus) => void;
  signal?: AbortSignal;
}

function normalizeTextValues(values: string[] | undefined) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function trimToTotalChars(values: string[], maxTotalChars: number) {
  const selected: string[] = [];
  let remainingChars = maxTotalChars;

  for (let index = values.length - 1; index >= 0 && remainingChars > 0; index -= 1) {
    const value = values[index]?.trim();

    if (!value) {
      continue;
    }

    const nextValue = value.length > remainingChars ? value.slice(0, remainingChars).trimEnd() : value;

    if (!nextValue) {
      continue;
    }

    selected.unshift(nextValue);
    remainingChars -= nextValue.length;
  }

  return selected;
}

function getTotalTextChars(values: string[]) {
  return values.reduce((total, value) => total + value.length, 0);
}

function splitDroppedContext(values: string[], selected: string[], maxItems: number) {
  const recentCandidates = values.slice(-maxItems);
  const droppedByItemCount = values.length - recentCandidates.length;
  const droppedByCharsCount = recentCandidates.length - selected.length;
  const dropped = [
    ...values.slice(0, Math.max(0, droppedByItemCount)),
    ...recentCandidates.slice(0, Math.max(0, droppedByCharsCount)),
  ];
  const selectedStartIndex = recentCandidates.length - selected.length;
  const firstSelectedCandidate = recentCandidates[selectedStartIndex];
  const firstSelectedValue = selected[0];

  if (
    firstSelectedCandidate !== undefined &&
    firstSelectedValue !== undefined &&
    firstSelectedCandidate !== firstSelectedValue
  ) {
    dropped.push(firstSelectedCandidate);
  }

  return dropped;
}

function normalizeHistorySummary(historySummary?: string) {
  const trimmedSummary = historySummary?.trim();
  return trimmedSummary ? trimmedSummary.slice(0, HISTORY_SUMMARY_MAX_CHARS) : undefined;
}

function buildCompactedHistoryRequest(request: PromptBuildRequest) {
  const allPreviousUserMessages = normalizeTextValues(request.previousUserMessages);
  const allPreviousChangeSummaries = normalizeTextValues(request.previousChangeSummaries);
  const previousUserMessages = trimToTotalChars(
    allPreviousUserMessages.slice(-PREVIOUS_USER_MESSAGES_MAX_ITEMS),
    PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS,
  );
  const previousChangeSummaries = trimToTotalChars(
    allPreviousChangeSummaries.slice(-PREVIOUS_CHANGE_SUMMARIES_MAX_ITEMS),
    PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS,
  );
  const previousUserMessagesTotalChars = getTotalTextChars(allPreviousUserMessages);
  const previousChangeSummariesTotalChars = getTotalTextChars(allPreviousChangeSummaries);
  const shouldSummarizeDroppedHistory =
    allPreviousUserMessages.length > PREVIOUS_USER_MESSAGES_MAX_ITEMS ||
    previousUserMessagesTotalChars > PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS ||
    previousChangeSummariesTotalChars > PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS;

  return {
    droppedHistorySummary: normalizeHistorySummary(request.historySummary),
    droppedPreviousChangeSummaries: splitDroppedContext(
      allPreviousChangeSummaries,
      previousChangeSummaries,
      PREVIOUS_CHANGE_SUMMARIES_MAX_ITEMS,
    ),
    droppedPreviousUserMessages: splitDroppedContext(
      allPreviousUserMessages,
      previousUserMessages,
      PREVIOUS_USER_MESSAGES_MAX_ITEMS,
    ),
    previousChangeSummaries,
    previousUserMessages,
    previousChangeSummariesTotalChars,
    previousUserMessagesTotalChars,
    shouldSummarizeDroppedHistory,
  };
}

async function compactRequestHistory(
  env: AppEnv,
  request: PromptBuildRequest,
  options: PrepareLlmInvocationOptions,
): Promise<{ compaction?: PreparedLlmInvocation['compaction']; request: PromptBuildRequest }> {
  const history = buildCompactedHistoryRequest(request);
  let historySummary = normalizeHistorySummary(request.historySummary);

  if (history.shouldSummarizeDroppedHistory) {
    options.onStatus?.('compacting-history');

    const summaryEnvelope = await generateHistorySummary(
      env,
      {
        ...(history.droppedHistorySummary ? { historySummary: history.droppedHistorySummary } : {}),
        previousChangeSummaries: history.droppedPreviousChangeSummaries,
        previousUserMessages: history.droppedPreviousUserMessages,
      },
      options.signal,
    );

    historySummary = normalizeHistorySummary(summaryEnvelope.historySummary) ?? historySummary;
  }

  return {
    compaction:
      history.shouldSummarizeDroppedHistory ||
      history.previousUserMessages.length !== (request.previousUserMessages ?? []).length ||
      history.previousChangeSummaries.length !== (request.previousChangeSummaries ?? []).length
        ? {
            compactedByBytes:
              history.previousUserMessagesTotalChars > PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS ||
              history.previousChangeSummariesTotalChars > PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS,
            compactedByItemLimit: (request.previousUserMessages ?? []).length > PREVIOUS_USER_MESSAGES_MAX_ITEMS,
            omittedChatMessages: Math.max(0, (request.previousUserMessages ?? []).length - history.previousUserMessages.length),
          }
        : undefined,
    request: {
      ...request,
      ...(historySummary ? { historySummary } : { historySummary: undefined }),
      previousChangeSummaries: history.previousChangeSummaries,
      previousUserMessages: history.previousUserMessages,
    },
  };
}

export async function prepareLlmInvocation(
  invocation: PreparedLlmInvocation,
  env: AppEnv,
  intakeRecorder: IntakeFailureRecorder,
  options: PrepareLlmInvocationOptions = {},
): Promise<PreparedLlmInvocation> {
  const compacted = await compactRequestHistory(env, invocation.request, options);
  const compactedRequestBytes = getLlmRequestSizeBytes(compacted.request);
  const omittedChatMessages = compacted.compaction?.omittedChatMessages ?? 0;

  if (compactedRequestBytes > env.requestMaxBytes) {
    const compactionError = new RequestValidationError(
      `Compacted request still exceeded the safe request limit of ${env.requestMaxBytes} bytes.`,
      413,
      {
        publicMessage: 'Request body is too large to process safely.',
      },
    );

    await intakeRecorder.recordIntake({
      compactedRequestBytes,
      omittedChatMessages,
      error: compactionError,
      requestBytes: invocation.requestBytes,
      requestId: invocation.requestId,
    });
    throw compactionError;
  }

  return {
    ...invocation,
    compaction: compacted.compaction,
    compactedRequestBytes,
    omittedChatMessages,
    request: compacted.request,
  };
}
