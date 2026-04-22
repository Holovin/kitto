import { detectControlActionBindingConflicts } from './detectors/controlActionBinding';
import { detectInlineToolCallIssues } from './detectors/inlineToolCall';
import { detectItemBoundControlsWithoutAction } from './detectors/itemBoundControl';
import {
  detectReservedLastChoiceRootIssues,
  detectReservedLastChoiceStatementIssues,
} from './detectors/lastChoiceOutsideAction';
import { detectArrayIndexPathMutationIssues } from './detectors/mutationIndexPath';
import { detectPersistedMutationRefreshWarnings } from './detectors/persistedMutationRefresh';
import { detectStructuralInvariantIssues } from './detectors/structuralInvariants';
import { detectUndefinedStateReferenceIssues } from './detectors/undefinedStateReference';
import { collectOpenUiParserValidationIssues } from './parser';
import {
  createParserIssue,
  normalizeSourceForValidation,
  parser,
  stripQualityIssueSeverity,
  type OpenUiQualityIssue,
  type OpenUiValidationResult,
} from './shared';
import { appendAutoFixSuggestionIssues, applyOpenUiIssueSuggestions } from './suggestions';

export { applyOpenUiIssueSuggestions };
export type { OpenUiQualityIssue, OpenUiQualityIssueSeverity, OpenUiValidationResult } from './shared';

export function detectOpenUiQualityIssues(source: string): OpenUiQualityIssue[] {
  const trimmedSource = typeof source === 'string' ? normalizeSourceForValidation(source) : '';

  if (!trimmedSource) {
    return [];
  }

  const result = parser.parse(trimmedSource);

  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root) {
    return [];
  }

  const issues: OpenUiQualityIssue[] = [];

  issues.push(...detectControlActionBindingConflicts(result.root));
  issues.push(...detectItemBoundControlsWithoutAction(trimmedSource));
  issues.push(...detectReservedLastChoiceRootIssues(result.root));
  issues.push(...detectReservedLastChoiceStatementIssues(trimmedSource, result));
  issues.push(...detectUndefinedStateReferenceIssues(trimmedSource, result));
  issues.push(...detectArrayIndexPathMutationIssues(result));
  issues.push(
    ...detectStructuralInvariantIssues(trimmedSource, result).map((issue) => ({
      ...issue,
      severity: 'fatal-quality' as const,
    })),
  );

  issues.push(
    ...detectInlineToolCallIssues(result).map((issue) => ({
      ...issue,
      severity: 'blocking-quality' as const,
    })),
  );

  issues.push(
    ...detectPersistedMutationRefreshWarnings(result).map((issue) => ({
      ...issue,
      severity: 'blocking-quality' as const,
    })),
  );

  return issues;
}

export function detectOpenUiQualityWarnings(source: string) {
  return detectOpenUiQualityIssues(source)
    .filter((issue) => issue.severity === 'soft-warning')
    .map(stripQualityIssueSeverity);
}

export function validateOpenUiSource(source: string): OpenUiValidationResult {
  const trimmedSource = typeof source === 'string' ? normalizeSourceForValidation(source) : '';

  if (!trimmedSource) {
    return {
      isValid: false,
      issues: [
        createParserIssue({
          code: 'empty-source',
          message: 'The model returned an empty OpenUI document.',
        }),
      ],
    };
  }

  if (trimmedSource.includes('```')) {
    return {
      isValid: false,
      issues: [
        createParserIssue({
          code: 'code-fence-present',
          message: 'Return raw OpenUI source without Markdown code fences.',
        }),
      ],
    };
  }

  const result = parser.parse(trimmedSource);
  const issues = [
    ...collectOpenUiParserValidationIssues(trimmedSource, result),
    ...detectStructuralInvariantIssues(trimmedSource, result),
    ...detectInlineToolCallIssues(result),
  ];
  const issuesWithSuggestions = appendAutoFixSuggestionIssues(trimmedSource, issues);

  return {
    isValid: issuesWithSuggestions.length === 0,
    issues: issuesWithSuggestions,
  };
}
