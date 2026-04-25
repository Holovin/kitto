import type { BuilderRequestLimits } from '@features/builder/config';
import { postCommitTelemetry } from '@features/builder/api/commitTelemetry';
import { createRequestId } from '@features/builder/api/requestId';
import { getBuilderRequestErrorMessage } from '@features/builder/api/requestErrors';
import { getBuilderSanitizedLlmRequestForTransport, validateBuilderLlmRequest } from '@features/builder/config';
import { FATAL_STRUCTURAL_INVARIANT_CODES } from '@features/builder/openui/runtime/validation/detectors/structuralInvariants';
import {
  detectLocalRuntimeQualityIssues,
  validateOpenUiSourceWithContext,
} from '@features/builder/openui/runtime/validation';
import type {
  BuilderGeneratedDraft,
  BuilderLlmChatMessage,
  BuilderLlmRequest,
  BuilderParseIssue,
  BuilderQualityIssue,
  BuilderRequestId,
} from '@features/builder/types';
import { createValidationFailureMessage } from './validationFailureMessage';

interface UseValidationRepairOptions {
  maxRepairAttempts: number | null;
  maxRepairValidationIssues: number | null;
  requestLimits: BuilderRequestLimits | null;
  runGenerateRequest: (
    requestId: BuilderRequestId,
    request: BuilderLlmRequest,
    options?: { requestKind?: 'automatic-repair' | 'stream-fallback'; transportRequestId?: BuilderRequestId },
  ) => Promise<BuilderGeneratedDraft>;
  showStreamingSummaryStatus: (requestId: BuilderRequestId, status: string) => void;
  throwIfInactiveRequest: (requestId: BuilderRequestId) => void;
}

export class OpenUiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenUiValidationError';
  }
}

function truncateRepairField(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, Math.max(1, maxLength - 1)).trimEnd() + '…';
}

function stripQualitySeverity(issue: BuilderQualityIssue): BuilderParseIssue {
  const strippedIssue: BuilderParseIssue = {
    code: issue.code,
    message: issue.message,
  };

  if (issue.context) {
    strippedIssue.context = issue.context;
  }

  if (issue.source) {
    strippedIssue.source = issue.source;
  }

  if (issue.statementId) {
    strippedIssue.statementId = issue.statementId;
  }

  if (issue.suggestion) {
    strippedIssue.suggestion = issue.suggestion;
  }

  return strippedIssue;
}

function getQualityIssueDedupeKey(issue: BuilderQualityIssue) {
  return [issue.severity, issue.source ?? '', issue.code.trim(), issue.statementId?.trim() ?? '', issue.message.trim()].join('\0');
}

export function dedupeQualityIssues(issues: BuilderQualityIssue[]) {
  const seenIssueKeys = new Set<string>();
  const dedupedIssues: BuilderQualityIssue[] = [];

  for (const issue of issues) {
    const issueKey = getQualityIssueDedupeKey(issue);

    if (seenIssueKeys.has(issueKey)) {
      continue;
    }

    seenIssueKeys.add(issueKey);
    dedupedIssues.push(issue);
  }

  return dedupedIssues;
}

const DEFAULT_MAX_REPAIR_VALIDATION_ISSUES = 20;

type RepairValidationIssue = BuilderParseIssue | BuilderQualityIssue;
type RepairIssueMode = 'parser' | 'quality';
type PendingQualityRepairTelemetry = {
  commitSource: BuilderGeneratedDraft['commitSource'];
  requestId: BuilderRequestId;
  validationIssues: string[];
};

const REPAIR_TIMEOUT_MESSAGE = 'The automatic repair took too long.';
const REPAIR_NETWORK_MESSAGE = 'The builder could not reach the backend while repairing the draft.';
const REPAIR_UPSTREAM_MESSAGE = 'The model service failed while repairing the draft.';
const REQUEST_TIMEOUT_MESSAGE = 'The model took too long to respond. Try again with a shorter or more specific prompt.';
const BACKEND_UNREACHABLE_MESSAGE = 'The builder could not reach the backend. Check that the server is running and try again.';
const UPSTREAM_FAILURE_MESSAGE = 'The model service failed while generating the draft. Please retry in a moment.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeUndefinedStateReferenceContext(issue: RepairValidationIssue): BuilderParseIssue['context'] | undefined {
  if (issue.code !== 'undefined-state-reference' || !isRecord(issue.context)) {
    return undefined;
  }

  const refName = typeof issue.context.refName === 'string' ? issue.context.refName.trim() : '';

  if (!refName) {
    return undefined;
  }

  const rawExampleInitializer = issue.context.exampleInitializer;

  if (rawExampleInitializer !== undefined && typeof rawExampleInitializer !== 'string') {
    return undefined;
  }

  return rawExampleInitializer === undefined
    ? { refName }
    : {
        exampleInitializer: rawExampleInitializer,
        refName,
      };
}

function sanitizeStalePersistedQueryContext(issue: RepairValidationIssue): BuilderParseIssue['context'] | undefined {
  if (issue.code !== 'quality-stale-persisted-query' || !isRecord(issue.context)) {
    return undefined;
  }

  const statementId = typeof issue.context.statementId === 'string' ? issue.context.statementId.trim() : '';
  const suggestedQueryRefs = Array.isArray(issue.context.suggestedQueryRefs)
    ? issue.context.suggestedQueryRefs.flatMap((statementId) => {
        const normalizedStatementId = typeof statementId === 'string' ? statementId.trim() : '';
        return normalizedStatementId ? [normalizedStatementId] : [];
      })
    : [];

  if (!statementId || suggestedQueryRefs.length === 0) {
    return undefined;
  }

  return {
    statementId,
    suggestedQueryRefs,
  };
}

function sanitizeOptionsShapeContext(issue: RepairValidationIssue): BuilderParseIssue['context'] | undefined {
  if (issue.code !== 'quality-options-shape' || !isRecord(issue.context)) {
    return undefined;
  }

  const groupId = typeof issue.context.groupId === 'string' ? issue.context.groupId.trim() : '';
  const invalidValues = Array.isArray(issue.context.invalidValues)
    ? issue.context.invalidValues.flatMap((value) => (typeof value === 'string' || typeof value === 'number' ? [value] : []))
    : [];

  if (!groupId || invalidValues.length === 0) {
    return undefined;
  }

  return {
    groupId,
    invalidValues,
  };
}

function sanitizeRepairIssueContext(issue: RepairValidationIssue): BuilderParseIssue['context'] | undefined {
  return (
    sanitizeUndefinedStateReferenceContext(issue) ??
    sanitizeStalePersistedQueryContext(issue) ??
    sanitizeOptionsShapeContext(issue)
  );
}

function getRepairValidationIssuePriority(issue: RepairValidationIssue) {
  if (issue.source === 'parser' && issue.code !== 'unresolved-reference') {
    return 0;
  }

  if ('severity' in issue && issue.severity === 'blocking-quality') {
    return 1;
  }

  return 2;
}

function sortRepairValidationIssues(issues: RepairValidationIssue[]) {
  return issues
    .map((issue, index) => ({
      index,
      issue,
      priority: getRepairValidationIssuePriority(issue),
    }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ issue }) => issue);
}

function formatRepairPendingMessage(attemptNumber: number) {
  const baseMessage = 'Something went wrong and your request was sent again';

  return attemptNumber > 1 ? `${baseMessage} (${attemptNumber})` : baseMessage;
}

function isRepairAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'BuilderRequestAbortedError');
}

function createRepairRequestError(message: string, error: unknown, fallbackMessage?: string) {
  const ignoredMessages = new Set([message, fallbackMessage].filter((value): value is string => Boolean(value)));
  const detailLines: string[] = [];

  if (isRecord(error)) {
    const code = typeof error.code === 'string' ? error.code.trim() : '';
    const status = typeof error.status === 'number' ? error.status : undefined;
    const rawMessage =
      typeof error.message === 'string'
        ? error.message.trim()
        : typeof error.error === 'string'
          ? error.error.trim()
          : '';

    if (code) {
      detailLines.push(`Code: ${code}`);
    }

    if (status !== undefined) {
      detailLines.push(`Status: ${status}`);
    }

    if (rawMessage && !ignoredMessages.has(rawMessage)) {
      detailLines.push(`Message: ${rawMessage}`);
    }
  }

  return new Error(detailLines.length > 0 ? `${message}\n${detailLines.join('\n')}` : message);
}

function wrapRepairRequestError(error: unknown) {
  if (isRepairAbortError(error)) {
    return error;
  }

  if (isRecord(error)) {
    const code = typeof error.code === 'string' ? error.code : undefined;
    const status = typeof error.status === 'number' ? error.status : undefined;

    if (code === 'timeout_error' || status === 504) {
      return createRepairRequestError(REPAIR_TIMEOUT_MESSAGE, error);
    }

    if (status === 502 || code === 'upstream_error') {
      return createRepairRequestError(REPAIR_UPSTREAM_MESSAGE, error);
    }
  }

  const message = getBuilderRequestErrorMessage(error);

  if (message === REQUEST_TIMEOUT_MESSAGE) {
    return createRepairRequestError(REPAIR_TIMEOUT_MESSAGE, error, message);
  }

  if (message === BACKEND_UNREACHABLE_MESSAGE) {
    return createRepairRequestError(REPAIR_NETWORK_MESSAGE, error, message);
  }

  if (message === UPSTREAM_FAILURE_MESSAGE) {
    return createRepairRequestError(REPAIR_UPSTREAM_MESSAGE, error, message);
  }

  return createRepairRequestError(`The automatic repair failed before commit. ${message}`, error, message);
}

export function sanitizeRepairValidationIssues(
  issues: RepairValidationIssue[],
  maxValidationIssues = DEFAULT_MAX_REPAIR_VALIDATION_ISSUES,
): BuilderParseIssue[] {
  const boundedMaxValidationIssues =
    Number.isInteger(maxValidationIssues) && maxValidationIssues > 0
      ? maxValidationIssues
      : DEFAULT_MAX_REPAIR_VALIDATION_ISSUES;

  return sortRepairValidationIssues(issues)
    .slice(0, boundedMaxValidationIssues)
    .map((issue) => {
      const sanitizedContext = sanitizeRepairIssueContext(issue);
      const sanitizedRepairIssue: BuilderParseIssue = {
        code: truncateRepairField(issue.code, 200),
        message: truncateRepairField(issue.message, 2_000),
      };

      if (issue.source) {
        sanitizedRepairIssue.source = issue.source;
      }

      if (issue.statementId) {
        sanitizedRepairIssue.statementId = truncateRepairField(issue.statementId, 200);
      }

      if (sanitizedContext) {
        sanitizedRepairIssue.context = sanitizedContext;
      }

      return sanitizedRepairIssue;
    });
}

export function buildRepairChatHistoryWithRejectedDraftNotice(
  chatHistory: BuilderLlmChatMessage[],
  issues: BuilderParseIssue[],
): BuilderLlmChatMessage[] {
  const issueCodes = [
    ...new Set(
      issues
        .map((issue) => issue.code.trim())
        .filter((code) => code.length > 0),
    ),
  ];
  const codeSummary =
    issueCodes.length > 0
      ? issueCodes.map((code) => `\`${code}\``).join(', ')
      : 'validation issues';

  return [
    ...chatHistory,
    {
      role: 'assistant',
      content: `Previous draft rejected due to: ${codeSummary}.`,
    },
  ];
}

export function useValidationRepair({
  maxRepairAttempts,
  maxRepairValidationIssues,
  requestLimits,
  runGenerateRequest,
  showStreamingSummaryStatus,
  throwIfInactiveRequest,
}: UseValidationRepairOptions) {
  async function ensureValidGeneratedSource(
    initialResponse: BuilderGeneratedDraft,
    request: BuilderLlmRequest,
    requestId: BuilderRequestId,
  ) {
    let candidateResponse: BuilderGeneratedDraft = { ...initialResponse };
    let parserRepairCount = 0;
    let qualityRepairCount = 0;
    let repairAttemptCount = 0;
    let hasCompletedRepairRequest = false;
    let pendingQualityRepairTelemetry: PendingQualityRepairTelemetry | null = null;

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

    function reportRejectedCandidate(issues: BuilderParseIssue[]) {
      if (candidateResponse.requestId.trim().length === 0) {
        return;
      }

      const validationIssues = [...new Set(issues.map((issue) => issue.code))];

      void postCommitTelemetry({
        commitSource: candidateResponse.commitSource,
        committed: false,
        requestId: candidateResponse.requestId,
        validationIssues,
      });
    }

    function queueQualityRepairOutcome(issues: BuilderQualityIssue[]) {
      if (pendingQualityRepairTelemetry) {
        return;
      }

      if (candidateResponse.requestId.trim().length === 0) {
        pendingQualityRepairTelemetry = null;
        return;
      }

      pendingQualityRepairTelemetry = {
        commitSource: candidateResponse.commitSource,
        requestId: candidateResponse.requestId,
        validationIssues: [...new Set(issues.map((issue) => issue.code))],
      };
    }

    function reportQualityRepairOutcome(repairOutcome: 'failed' | 'fixed') {
      if (!pendingQualityRepairTelemetry) {
        return;
      }

      const telemetry = pendingQualityRepairTelemetry;
      pendingQualityRepairTelemetry = null;

      void postCommitTelemetry({
        commitSource: telemetry.commitSource,
        committed: false,
        repairOutcome,
        requestId: telemetry.requestId,
        validationIssues: telemetry.validationIssues,
      });
    }

    async function runRepairRequest(issues: RepairValidationIssue[], issueMode: RepairIssueMode) {
      if (requestLimits === null) {
        throw new Error('Chat send is unavailable until the runtime config has loaded.');
      }

      if (maxRepairValidationIssues === null) {
        throw new Error('Chat send is unavailable until the runtime config has loaded.');
      }

      if (maxRepairAttempts === null) {
        throw new Error('Chat send is unavailable until the runtime config has loaded.');
      }

      if (repairAttemptCount >= maxRepairAttempts) {
        throw new OpenUiValidationError(
          createValidationFailureMessage(
            issues.map((issue) => ('severity' in issue ? stripQualitySeverity(issue) : issue)),
            parserRepairCount + qualityRepairCount,
          ),
        );
      }

      repairAttemptCount += 1;
      reportRejectedCandidate(issues.map((issue) => ('severity' in issue ? stripQualitySeverity(issue) : issue)));
      const validationIssues = sanitizeRepairValidationIssues(issues, maxRepairValidationIssues);
      const repairRequest: BuilderLlmRequest = {
        prompt: request.prompt,
        currentSource: request.currentSource,
        chatHistory: buildRepairChatHistoryWithRejectedDraftNotice(request.chatHistory, validationIssues),
        invalidDraft: candidateResponse.source,
        mode: 'repair',
        parentRequestId: requestId,
        repairAttemptNumber: repairAttemptCount,
        validationIssues,
      };
      const transportRequest = getBuilderSanitizedLlmRequestForTransport(repairRequest, requestLimits);
      const repairRequestValidationError = validateBuilderLlmRequest(transportRequest, requestLimits);

      if (repairRequestValidationError) {
        throw new Error(repairRequestValidationError);
      }

      throwIfInactiveRequest(requestId);
      showStreamingSummaryStatus(requestId, formatRepairPendingMessage(repairAttemptCount));

      try {
        const repairedResponse = await runGenerateRequest(requestId, transportRequest, {
          requestKind: 'automatic-repair',
          transportRequestId: createRequestId(),
        });
        throwIfInactiveRequest(requestId);
        hasCompletedRepairRequest = true;
        candidateResponse = repairedResponse;
      } catch (error) {
        if (issueMode === 'quality' && !isRepairAbortError(error)) {
          reportQualityRepairOutcome('failed');
        }

        throw wrapRepairRequestError(error);
      }
    }

    while (true) {
      const validationContext = validateOpenUiSourceWithContext(candidateResponse.source);
      const validation = validationContext.validation;

      if (!validation.isValid) {
        const fatalValidationIssues = validation.issues.filter((issue) => FATAL_STRUCTURAL_INVARIANT_CODES.has(issue.code));

        if (fatalValidationIssues.length > 0) {
          reportRejectedCandidate(fatalValidationIssues);
          reportQualityRepairOutcome('failed');
          throw new OpenUiValidationError(createValidationFailureMessage(fatalValidationIssues, parserRepairCount + qualityRepairCount));
        }
      }

      if (validation.isValid) {
        const qualityIssues = dedupeQualityIssues([
          ...detectLocalRuntimeQualityIssues(candidateResponse.source, {
            normalizedSource: validationContext.normalizedSource,
            parseResult: validationContext.parseResult,
            validationIssues: validation.issues,
          }),
          ...(candidateResponse.qualityIssues ?? []),
        ]);
        const fatalQualityIssues = qualityIssues.filter((issue) => issue.severity === 'fatal-quality');
        const blockingQualityIssues = qualityIssues.filter((issue) => issue.severity === 'blocking-quality');
        const qualityWarnings = qualityIssues.filter((issue) => issue.severity === 'soft-warning').map(stripQualitySeverity);

        if (fatalQualityIssues.length > 0) {
          reportRejectedCandidate(fatalQualityIssues.map(stripQualitySeverity));
          reportQualityRepairOutcome('failed');
          throw new OpenUiValidationError(
            createValidationFailureMessage(
              fatalQualityIssues.map(stripQualitySeverity),
              parserRepairCount + qualityRepairCount,
            ),
          );
        }

        if (blockingQualityIssues.length > 0) {
          if (maxRepairAttempts === null) {
            throw new Error('Chat send is unavailable until the runtime config has loaded.');
          }

          if (repairAttemptCount >= maxRepairAttempts) {
            reportRejectedCandidate(blockingQualityIssues.map(stripQualitySeverity));
            reportQualityRepairOutcome('failed');
            throw new OpenUiValidationError(
              createValidationFailureMessage(
                blockingQualityIssues.map(stripQualitySeverity),
                parserRepairCount + qualityRepairCount,
              ),
            );
          }

          qualityRepairCount += 1;
          queueQualityRepairOutcome(blockingQualityIssues);
          await runRepairRequest(blockingQualityIssues, 'quality');
          continue;
        }

        reportQualityRepairOutcome('fixed');
        return {
          commitSource: candidateResponse.commitSource,
          note: hasCompletedRepairRequest ? buildRepairNote() : undefined,
          requestId: candidateResponse.requestId,
          source: candidateResponse.source,
          summary: candidateResponse.summary,
          summaryExcludeFromLlmContext: candidateResponse.summaryExcludeFromLlmContext,
          warnings: qualityWarnings,
        };
      }

      if (maxRepairAttempts === null) {
        throw new Error('Chat send is unavailable until the runtime config has loaded.');
      }

      if (repairAttemptCount >= maxRepairAttempts) {
        reportRejectedCandidate(validation.issues);
        reportQualityRepairOutcome('failed');
        throw new OpenUiValidationError(createValidationFailureMessage(validation.issues, parserRepairCount + qualityRepairCount));
      }

      parserRepairCount += 1;
      await runRepairRequest(validation.issues, 'parser');
    }
  }

  return {
    ensureValidGeneratedSource,
  };
}
