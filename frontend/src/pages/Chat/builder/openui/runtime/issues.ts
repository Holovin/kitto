import type { OpenUIError, ParseResult } from '@openuidev/react-lang';
import type { PromptBuildValidationIssue } from '@pages/Chat/builder/types';

export function getRuntimeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'Unknown runtime error.';
}

export function mapParseResultToIssues(result: ParseResult | null): PromptBuildValidationIssue[] {
  if (!result) {
    return [];
  }

  const validationIssues: PromptBuildValidationIssue[] = result.meta.errors.map((error) => ({
    code: error.code,
    message: error.message,
    statementId: error.statementId,
    source: 'parser',
  }));

  const unresolvedIssues =
    !result.meta.incomplete && result.meta.unresolved.length > 0
      ? result.meta.unresolved.map<PromptBuildValidationIssue>((statementId) => ({
          code: 'unresolved-reference',
          message: 'This statement was referenced but never defined in the final source.',
          statementId,
          source: 'parser',
        }))
      : [];

  return [...validationIssues, ...unresolvedIssues];
}

export function mapOpenUiErrorsToIssues(errors: OpenUIError[]): PromptBuildValidationIssue[] {
  return errors.map((error) => ({
    code: error.code,
    message: error.message,
    statementId: error.statementId,
    source: error.source,
  }));
}

export function combinePreviewIssues(args: {
  isPreviewEmptyCanvas: boolean;
  isShowingRejectedDefinition: boolean;
  parseIssues: PromptBuildValidationIssue[];
  runtimeIssues: PromptBuildValidationIssue[];
}) {
  const { isPreviewEmptyCanvas, isShowingRejectedDefinition, parseIssues, runtimeIssues } = args;

  if (isPreviewEmptyCanvas || isShowingRejectedDefinition) {
    return parseIssues;
  }

  return [...parseIssues, ...runtimeIssues];
}

export function shouldResetRuntimeIssues(args: {
  nextPreviewSource: string;
  nextRejectedDefinition: boolean;
  previousPreviewSource: string | null;
  previousRejectedDefinition: boolean | null;
}) {
  const { nextPreviewSource, nextRejectedDefinition, previousPreviewSource, previousRejectedDefinition } = args;

  return (
    previousPreviewSource === null ||
    previousPreviewSource !== nextPreviewSource ||
    previousRejectedDefinition !== nextRejectedDefinition
  );
}

export function createRendererCrashIssue(error: unknown, code: string, summary: string): PromptBuildValidationIssue {
  return {
    code,
    message: `${summary} Details: ${getRuntimeErrorMessage(error)}`,
    source: 'runtime',
  };
}
