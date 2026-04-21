import type { BuilderRequestLimits } from '@features/builder/config';
import { postCommitTelemetry } from '@features/builder/api/commitTelemetry';
import { createRequestId } from '@features/builder/api/requestId';
import { validateBuilderLlmRequest } from '@features/builder/config';
import { applyOpenUiIssueSuggestions, detectOpenUiQualityIssues, validateOpenUiSource } from '@features/builder/openui/runtime/validation';
import { builderActions } from '@features/builder/store/builderSlice';
import type { BuilderGeneratedDraft, BuilderLlmRequest, BuilderParseIssue, BuilderRequestId } from '@features/builder/types';
import { useAppDispatch } from '@store/hooks';
import { buildRepairPrompt, MAX_AUTO_REPAIR_ATTEMPTS } from './repairPrompt';
import { createValidationFailureMessage } from './validationFailureMessage';

interface UseValidationRepairOptions {
  requestLimits: BuilderRequestLimits;
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

function logLocalAutoFix(appliedIssues: BuilderParseIssue[]) {
  if (appliedIssues.length === 0) {
    return;
  }

  const appliedLabels = appliedIssues.map((issue) => `${issue.code}${issue.statementId ? ` in ${issue.statementId}` : ''}`);
  console.info(`[builder.validation] auto-fixed locally: ${appliedLabels.join(', ')}`);
}

export function useValidationRepair({
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

    async function runRepairRequest(issues: Parameters<typeof buildRepairPrompt>[0]['issues'], attemptNumber: number) {
      reportRejectedCandidate(issues);
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
        parentRequestId: requestId,
        validationIssues: issues.map((issue) => issue.code),
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
          reportRejectedCandidate(
            fatalQualityIssues.map(({ severity, ...issue }) => {
              void severity;
              return issue;
            }),
          );
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
            reportRejectedCandidate(
              blockingQualityIssues.map(({ severity, ...issue }) => {
                void severity;
                return issue;
              }),
            );
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
          commitSource: candidateResponse.commitSource,
          note: hasCompletedRepairRequest ? buildRepairNote() : undefined,
          notes: candidateResponse.notes,
          requestId: candidateResponse.requestId,
          source: candidateResponse.source,
          summary: candidateResponse.summary,
          warnings: qualityWarnings,
        };
      }

      if (parserRepairCount >= MAX_AUTO_REPAIR_ATTEMPTS) {
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
