import type { OpenUIError, ParseResult } from '@openuidev/react-lang';
import type { BuilderParseIssue } from '@features/builder/types';

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
