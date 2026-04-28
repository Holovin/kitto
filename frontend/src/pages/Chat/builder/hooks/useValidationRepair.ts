import type { BuilderRequestLimits } from '@pages/Chat/builder/config';
import { DEFAULT_MAX_REPAIR_VALIDATION_ISSUES } from '@kitto-openui/shared/builderApiContract.js';
import { isRecord } from '@kitto-openui/shared/objectGuards.js';
import { postCommitTelemetry } from '@pages/Chat/builder/api/commitTelemetry';
import { createRequestId } from '@pages/Chat/builder/api/requestId';
import { getBuilderRequestErrorMessage } from '@pages/Chat/builder/api/requestErrors';
import { getBuilderSanitizedLlmRequestForTransport, validateBuilderLlmRequest } from '@pages/Chat/builder/config';
import {
  detectLocalRuntimeQualityIssues,
  validateOpenUiSourceWithContext,
} from '@pages/Chat/builder/openui/runtime/validation';
import type {
  BuilderGeneratedDraft,
  PromptBuildRequest,
  PromptBuildValidationIssue,
  BuilderQualityIssue,
  BuilderRequestId,
} from '@pages/Chat/builder/types';
import {
  getOpenUiQualityIssueSeverity,
  isOpenUiBlockingQualityIssue,
} from '@kitto-openui/shared/openuiQualityIssueRegistry.js';
import { createValidationFailureMessage } from './validationFailureMessage';

interface UseValidationRepairOptions {
  maxRepairAttempts: number | null;
  maxRepairValidationIssues: number | null;
  requestLimits: BuilderRequestLimits | null;
  runGenerateRequest: (
    requestId: BuilderRequestId,
    request: PromptBuildRequest,
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

function stripQualitySeverity(issue: BuilderQualityIssue): PromptBuildValidationIssue {
  const strippedIssue: PromptBuildValidationIssue = {
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

type RepairValidationIssue = PromptBuildValidationIssue | BuilderQualityIssue;
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

function isRepairQualityIssue(issue: RepairValidationIssue): issue is BuilderQualityIssue {
  return typeof issue.severity === 'string';
}

function stripRepairQualitySeverity(issue: RepairValidationIssue) {
  return isRepairQualityIssue(issue) ? stripQualitySeverity(issue) : issue;
}

function sanitizeUndefinedStateReferenceContext(issue: RepairValidationIssue): PromptBuildValidationIssue['context'] | undefined {
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

function sanitizeStalePersistedQueryContext(issue: RepairValidationIssue): PromptBuildValidationIssue['context'] | undefined {
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

function sanitizeOptionsShapeContext(issue: RepairValidationIssue): PromptBuildValidationIssue['context'] | undefined {
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

function sanitizeMissingControlShowcaseComponentsContext(issue: RepairValidationIssue): PromptBuildValidationIssue['context'] | undefined {
  if (issue.code !== 'quality-missing-control-showcase-components' || !isRecord(issue.context)) {
    return undefined;
  }

  const missingComponents = Array.isArray(issue.context.missingComponents)
    ? issue.context.missingComponents.flatMap((componentName) => {
        const normalizedComponentName = typeof componentName === 'string' ? componentName.trim() : '';
        return normalizedComponentName ? [normalizedComponentName] : [];
      })
    : [];

  return missingComponents.length > 0 ? { missingComponents } : undefined;
}

function sanitizeRepairIssueContext(issue: RepairValidationIssue): PromptBuildValidationIssue['context'] | undefined {
  return (
    sanitizeUndefinedStateReferenceContext(issue) ??
    sanitizeStalePersistedQueryContext(issue) ??
    sanitizeOptionsShapeContext(issue) ??
    sanitizeMissingControlShowcaseComponentsContext(issue)
  );
}

function getRepairValidationIssuePriority(issue: RepairValidationIssue) {
  if (issue.source === 'parser' && issue.code !== 'unresolved-reference') {
    return 0;
  }

  if (isOpenUiBlockingQualityIssue(issue)) {
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
): PromptBuildValidationIssue[] {
  return sortRepairValidationIssues(issues)
    .slice(0, maxValidationIssues)
    .map((issue) => {
      const sanitizedContext = sanitizeRepairIssueContext(issue);
      const severity = getOpenUiQualityIssueSeverity(issue);
      const sanitizedRepairIssue: PromptBuildValidationIssue = {
        code: truncateRepairField(issue.code, 200),
        message: truncateRepairField(issue.message, 2_000),
      };

      if (severity) {
        sanitizedRepairIssue.severity = severity;
      }

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
    request: PromptBuildRequest,
    requestId: BuilderRequestId,
  ) {
    let candidateResponse: BuilderGeneratedDraft = { ...initialResponse };
    let parserRepairCount = 0;
    let qualityRepairCount = 0;
    let hasCompletedRepairRequest = false;
    let pendingQualityRepairTelemetry: PendingQualityRepairTelemetry | null = null;

    function getRepairAttemptCount() {
      return parserRepairCount + qualityRepairCount;
    }

    function registerRepairAttempt(issueMode: RepairIssueMode) {
      if (issueMode === 'parser') {
        parserRepairCount += 1;
      } else {
        qualityRepairCount += 1;
      }

      return getRepairAttemptCount();
    }

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

    function reportRejectedCandidate(issues: PromptBuildValidationIssue[]) {
      if (candidateResponse.requestId.trim().length === 0) {
        return;
      }

      const validationIssues = [...new Set(issues.map((issue) => issue.code))];

      postCommitTelemetry({
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

      postCommitTelemetry({
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

      const currentRepairAttemptCount = getRepairAttemptCount();

      if (currentRepairAttemptCount >= maxRepairAttempts) {
        throw new OpenUiValidationError(
          createValidationFailureMessage(
            issues.map(stripRepairQualitySeverity),
            currentRepairAttemptCount,
          ),
        );
      }

      const repairAttemptNumber = registerRepairAttempt(issueMode);
      reportRejectedCandidate(issues.map(stripRepairQualitySeverity));
      const validationIssues = sanitizeRepairValidationIssues(issues, maxRepairValidationIssues);

      const repairRequest: PromptBuildRequest = {
        prompt: request.prompt,
        ...(request.appMemory !== undefined ? { appMemory: request.appMemory } : {}),
        currentSource: request.currentSource,
        ...((candidateResponse.historySummary ?? request.historySummary) !== undefined
          ? { historySummary: candidateResponse.historySummary ?? request.historySummary }
          : {}),
        ...(request.previousSource !== undefined ? { previousSource: request.previousSource } : {}),
        previousChangeSummaries: request.previousChangeSummaries ?? [],
        previousUserMessages: request.previousUserMessages ?? [],
        invalidDraft: candidateResponse.source,
        mode: 'repair',
        parentRequestId: requestId,
        repairAttemptNumber,
        validationIssues,
      };
      const transportRequest = getBuilderSanitizedLlmRequestForTransport(repairRequest);
      const repairRequestValidationError = validateBuilderLlmRequest(transportRequest, requestLimits);

      if (repairRequestValidationError) {
        throw new Error(repairRequestValidationError);
      }

      throwIfInactiveRequest(requestId);
      showStreamingSummaryStatus(requestId, formatRepairPendingMessage(getRepairAttemptCount()));

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
        const fatalValidationIssues = validation.issues.filter(
          (issue) => getOpenUiQualityIssueSeverity(issue) === 'fatal-quality',
        );

        if (fatalValidationIssues.length > 0) {
          reportRejectedCandidate(fatalValidationIssues);
          reportQualityRepairOutcome('failed');
          throw new OpenUiValidationError(
            createValidationFailureMessage(fatalValidationIssues, getRepairAttemptCount()),
          );
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
              getRepairAttemptCount(),
            ),
          );
        }

        if (blockingQualityIssues.length > 0) {
          if (maxRepairAttempts === null) {
            throw new Error('Chat send is unavailable until the runtime config has loaded.');
          }

          if (getRepairAttemptCount() >= maxRepairAttempts) {
            reportRejectedCandidate(blockingQualityIssues.map(stripQualitySeverity));
            reportQualityRepairOutcome('failed');
            throw new OpenUiValidationError(
              createValidationFailureMessage(
                blockingQualityIssues.map(stripQualitySeverity),
                getRepairAttemptCount(),
              ),
            );
          }

          queueQualityRepairOutcome(blockingQualityIssues);
          await runRepairRequest(blockingQualityIssues, 'quality');
          continue;
        }

        reportQualityRepairOutcome('fixed');
        return {
          appMemory: candidateResponse.appMemory,
          changeSummary: candidateResponse.changeSummary,
          commitSource: candidateResponse.commitSource,
          note: hasCompletedRepairRequest ? buildRepairNote() : undefined,
          promptContext: candidateResponse.promptContext,
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

      if (getRepairAttemptCount() >= maxRepairAttempts) {
        reportRejectedCandidate(validation.issues);
        reportQualityRepairOutcome('failed');
        throw new OpenUiValidationError(
          createValidationFailureMessage(validation.issues, getRepairAttemptCount()),
        );
      }

      await runRepairRequest(validation.issues, 'parser');
    }
  }

  return {
    ensureValidGeneratedSource,
  };
}
