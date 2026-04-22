import type { BuilderRequestLimits } from '@features/builder/config';
import { postCommitTelemetry } from '@features/builder/api/commitTelemetry';
import { createRequestId } from '@features/builder/api/requestId';
import { validateBuilderLlmRequest } from '@features/builder/config';
import { FATAL_STRUCTURAL_INVARIANT_CODES } from '@features/builder/openui/runtime/validation/detectors/structuralInvariants';
import { applyOpenUiIssueSuggestions, detectOpenUiQualityIssues, validateOpenUiSource } from '@features/builder/openui/runtime/validation';
import { builderActions } from '@features/builder/store/builderSlice';
import type { BuilderGeneratedDraft, BuilderLlmRequest, BuilderParseIssue, BuilderQualityIssue, BuilderRequestId } from '@features/builder/types';
import { useAppDispatch } from '@store/hooks';
import { createValidationFailureMessage } from './validationFailureMessage';

interface UseValidationRepairOptions {
  maxRepairAttempts: number | null;
  maxRepairValidationIssues: number | null;
  requestLimits: BuilderRequestLimits | null;
  runGenerateRequest: (
    requestId: BuilderRequestId,
    request: BuilderLlmRequest,
    options?: { transportRequestId?: BuilderRequestId },
  ) => Promise<BuilderGeneratedDraft>;
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
  const { severity, ...strippedIssue } = issue;
  void severity;
  return strippedIssue;
}

const DEFAULT_MAX_REPAIR_VALIDATION_ISSUES = 20;
const REPAIR_BLOCKING_QUALITY_CODES = new Set([
  'control-action-and-binding',
  'inline-tool-in-each',
  'inline-tool-in-prop',
  'inline-tool-in-repeater',
  'item-bound-control-without-action',
  'mutation-uses-array-index-path',
  'quality-options-shape',
  'quality-stale-persisted-query',
  'reserved-last-choice-outside-action-mode',
  'undefined-state-reference',
]);

type RepairValidationIssue = BuilderParseIssue | BuilderQualityIssue;

function getRepairValidationIssuePriority(issue: RepairValidationIssue) {
  if (issue.source === 'parser' && issue.code !== 'unresolved-reference') {
    return 0;
  }

  if (
    ('severity' in issue && issue.severity === 'blocking-quality') ||
    REPAIR_BLOCKING_QUALITY_CODES.has(issue.code)
  ) {
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
      const { severity, suggestion, ...sanitizedIssue } = issue as RepairValidationIssue & {
        severity?: BuilderQualityIssue['severity'];
      };
      void suggestion;
      void severity;
      return {
        ...sanitizedIssue,
        code: truncateRepairField(sanitizedIssue.code, 200),
        message: truncateRepairField(sanitizedIssue.message, 2_000),
        statementId: sanitizedIssue.statementId ? truncateRepairField(sanitizedIssue.statementId, 200) : undefined,
      };
    });
}

function logLocalAutoFix(appliedIssues: BuilderParseIssue[]) {
  if (appliedIssues.length === 0) {
    return;
  }

  const appliedLabels = appliedIssues.map((issue) => `${issue.code}${issue.statementId ? ` in ${issue.statementId}` : ''}`);
  console.info(`[builder.validation] auto-fixed locally: ${appliedLabels.join(', ')}`);
}

export function useValidationRepair({
  maxRepairAttempts,
  maxRepairValidationIssues,
  requestLimits,
  runGenerateRequest,
  throwIfInactiveRequest,
}: UseValidationRepairOptions) {
  const dispatch = useAppDispatch();

  async function ensureValidGeneratedSource(
    initialResponse: BuilderGeneratedDraft,
    request: BuilderLlmRequest,
    requestId: BuilderRequestId,
  ) {
    let candidateResponse: BuilderGeneratedDraft = { ...initialResponse };
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

    async function runRepairRequest(issues: RepairValidationIssue[], attemptNumber: number) {
      if (requestLimits === null) {
        throw new Error('Chat send is unavailable until the runtime config has loaded.');
      }

      if (maxRepairValidationIssues === null) {
        throw new Error('Chat send is unavailable until the runtime config has loaded.');
      }

      reportRejectedCandidate(issues.map((issue) => ('severity' in issue ? stripQualitySeverity(issue) : issue)));
      const repairRequest: BuilderLlmRequest = {
        prompt: request.prompt,
        currentSource: request.currentSource,
        chatHistory: request.chatHistory,
        invalidDraft: candidateResponse.source,
        mode: 'repair',
        parentRequestId: requestId,
        repairAttemptNumber: attemptNumber,
        validationIssues: sanitizeRepairValidationIssues(issues, maxRepairValidationIssues),
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

      const repairedResponse = await runGenerateRequest(requestId, repairRequest, {
        transportRequestId: createRequestId(),
      });
      throwIfInactiveRequest(requestId);
      hasCompletedRepairRequest = true;
      candidateResponse = repairedResponse;
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

        const fatalValidationIssues = validation.issues.filter((issue) => FATAL_STRUCTURAL_INVARIANT_CODES.has(issue.code));

        if (fatalValidationIssues.length > 0) {
          reportRejectedCandidate(fatalValidationIssues);
          throw new OpenUiValidationError(createValidationFailureMessage(fatalValidationIssues, parserRepairCount + qualityRepairCount));
        }
      }

      if (validation.isValid) {
        const qualityIssues = [
          ...detectOpenUiQualityIssues(candidateResponse.source),
          ...(candidateResponse.qualityIssues ?? []),
        ];
        const fatalQualityIssues = qualityIssues.filter((issue) => issue.severity === 'fatal-quality');
        const blockingQualityIssues = qualityIssues.filter((issue) => issue.severity === 'blocking-quality');
        const qualityWarnings = qualityIssues.filter((issue) => issue.severity === 'soft-warning').map(stripQualitySeverity);

        if (fatalQualityIssues.length > 0) {
          reportRejectedCandidate(fatalQualityIssues.map(stripQualitySeverity));
          throw new OpenUiValidationError(
            createValidationFailureMessage(
              fatalQualityIssues.map(stripQualitySeverity),
              parserRepairCount + qualityRepairCount,
            ),
          );
        }

        if (blockingQualityIssues.length > 0) {
          if (qualityRepairCount >= 1) {
            reportRejectedCandidate(blockingQualityIssues.map(stripQualitySeverity));
            throw new OpenUiValidationError(
              createValidationFailureMessage(
                blockingQualityIssues.map(stripQualitySeverity),
                parserRepairCount + qualityRepairCount,
              ),
            );
          }

          qualityRepairCount += 1;
          await runRepairRequest(blockingQualityIssues, qualityRepairCount);
          continue;
        }

        return {
          commitSource: candidateResponse.commitSource,
          note: hasCompletedRepairRequest ? buildRepairNote() : undefined,
          requestId: candidateResponse.requestId,
          source: candidateResponse.source,
          summary: candidateResponse.summary,
          warnings: qualityWarnings,
        };
      }

      if (maxRepairAttempts === null) {
        throw new Error('Chat send is unavailable until the runtime config has loaded.');
      }

      if (parserRepairCount >= maxRepairAttempts) {
        reportRejectedCandidate(validation.issues);
        throw new OpenUiValidationError(createValidationFailureMessage(validation.issues, parserRepairCount + qualityRepairCount));
      }

      parserRepairCount += 1;
      await runRepairRequest(validation.issues, parserRepairCount);
    }
  }

  return {
    ensureValidGeneratedSource,
  };
}
