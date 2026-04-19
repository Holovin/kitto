import type { OpenUIError, ParseResult } from '@openuidev/react-lang';
import type { BuilderParseIssue } from '@features/builder/types';

function getRuntimeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'Unknown runtime error.';
}

export function mapParseResultToIssues(result: ParseResult | null): BuilderParseIssue[] {
  if (!result) {
    return [];
  }

  const validationIssues: BuilderParseIssue[] = result.meta.errors.map((error) => ({
    code: error.code,
    message: error.message,
    statementId: error.statementId,
    source: 'parser',
  }));

  const unresolvedIssues =
    !result.meta.incomplete && result.meta.unresolved.length > 0
      ? result.meta.unresolved.map<BuilderParseIssue>((statementId) => ({
          code: 'unresolved-reference',
          message: 'This statement was referenced but never defined in the final source.',
          statementId,
          source: 'parser',
        }))
      : [];

  return [...validationIssues, ...unresolvedIssues];
}

export function mapOpenUiErrorsToIssues(errors: OpenUIError[]): BuilderParseIssue[] {
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
  parseIssues: BuilderParseIssue[];
  runtimeIssues: BuilderParseIssue[];
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

export function createRendererCrashIssue(error: unknown, code: string, summary: string): BuilderParseIssue {
  return {
    code,
    message: `${summary} Details: ${getRuntimeErrorMessage(error)}`,
    source: 'runtime',
  };
}
