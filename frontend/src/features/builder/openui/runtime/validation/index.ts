import { detectControlActionBindingConflicts } from '@features/builder/openui/runtime/validation/detectors/controlActionBinding';
import { detectInlineToolCallIssues } from '@features/builder/openui/runtime/validation/detectors/inlineToolCall';
import { detectItemBoundControlsWithoutAction } from '@features/builder/openui/runtime/validation/detectors/itemBoundControl';
import {
  detectReservedLastChoiceRootIssues,
  detectReservedLastChoiceStatementIssues,
} from '@features/builder/openui/runtime/validation/detectors/lastChoiceOutsideAction';
import { detectArrayIndexPathMutationIssues } from '@features/builder/openui/runtime/validation/detectors/mutationIndexPath';
import { detectChoiceOptionsShapeIssues } from '@features/builder/openui/runtime/validation/detectors/optionsShape';
import { detectPersistedMutationRefreshWarnings } from '@features/builder/openui/runtime/validation/detectors/persistedMutationRefresh';
import { FATAL_STRUCTURAL_INVARIANT_CODES, detectStructuralInvariantIssues } from '@features/builder/openui/runtime/validation/detectors/structuralInvariants';
import { detectUndefinedStateReferenceIssues } from '@features/builder/openui/runtime/validation/detectors/undefinedStateReference';
import { collectOpenUiParserValidationIssues } from './parser';
import {
  createParserIssue,
  normalizeSourceForValidation,
  parser,
  type OpenUiQualityIssue,
  type OpenUiValidationContext,
  type OpenUiValidationResult,
} from './shared';

const INLINE_TOOL_CALL_ISSUE_CODES = new Set([
  'inline-tool-in-each',
  'inline-tool-in-prop',
  'inline-tool-in-repeater',
]);

type LocalRuntimeQualityIssueOptions = Partial<Pick<OpenUiValidationContext, 'normalizedSource' | 'parseResult'>> & {
  validationIssues?: OpenUiValidationResult['issues'];
};

function mapKnownValidationQualityIssues(validationIssues?: OpenUiValidationResult['issues']): OpenUiQualityIssue[] | null {
  if (!validationIssues) {
    return null;
  }

  const qualityIssues: OpenUiQualityIssue[] = [];

  for (const issue of validationIssues) {
    if (FATAL_STRUCTURAL_INVARIANT_CODES.has(issue.code)) {
      qualityIssues.push({ ...issue, severity: 'fatal-quality' });
      continue;
    }

    if (INLINE_TOOL_CALL_ISSUE_CODES.has(issue.code)) {
      qualityIssues.push({ ...issue, severity: 'blocking-quality' });
    }
  }

  return qualityIssues;
}

export function detectLocalRuntimeQualityIssues(
  source: string,
  options: LocalRuntimeQualityIssueOptions = {},
): OpenUiQualityIssue[] {
  const trimmedSource =
    typeof options.normalizedSource === 'string'
      ? options.normalizedSource
      : typeof source === 'string'
        ? normalizeSourceForValidation(source)
        : '';

  if (!trimmedSource) {
    return [];
  }

  const result = options.parseResult ?? parser.parse(trimmedSource);

  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root) {
    return [];
  }

  const issues: OpenUiQualityIssue[] = [];
  const knownValidationQualityIssues = mapKnownValidationQualityIssues(options.validationIssues);

  issues.push(...detectChoiceOptionsShapeIssues(trimmedSource));
  issues.push(...detectControlActionBindingConflicts(result.root));
  issues.push(...detectItemBoundControlsWithoutAction(trimmedSource));
  issues.push(...detectReservedLastChoiceRootIssues(result.root));
  issues.push(...detectReservedLastChoiceStatementIssues(trimmedSource, result));
  issues.push(...detectUndefinedStateReferenceIssues(trimmedSource, result));
  issues.push(...detectArrayIndexPathMutationIssues(result));

  if (knownValidationQualityIssues) {
    issues.push(...knownValidationQualityIssues);
  } else {
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
  }

  issues.push(
    ...detectPersistedMutationRefreshWarnings(result).map((issue) => ({
      ...issue,
      severity: 'blocking-quality' as const,
    })),
  );

  return issues;
}

export function validateOpenUiSourceWithContext(source: string): OpenUiValidationContext {
  const trimmedSource = typeof source === 'string' ? normalizeSourceForValidation(source) : '';

  if (!trimmedSource) {
    return {
      normalizedSource: trimmedSource,
      parseResult: null,
      validation: {
        isValid: false,
        issues: [
          createParserIssue({
            code: 'empty-source',
            message: 'The model returned an empty OpenUI document.',
          }),
        ],
      },
    };
  }

  if (trimmedSource.includes('```')) {
    return {
      normalizedSource: trimmedSource,
      parseResult: null,
      validation: {
        isValid: false,
        issues: [
          createParserIssue({
            code: 'code-fence-present',
            message: 'Return raw OpenUI source without Markdown code fences.',
          }),
        ],
      },
    };
  }

  const result = parser.parse(trimmedSource);
  const issues = [
    ...collectOpenUiParserValidationIssues(trimmedSource, result),
    ...detectStructuralInvariantIssues(trimmedSource, result),
    ...detectInlineToolCallIssues(result),
  ];

  return {
    normalizedSource: trimmedSource,
    parseResult: result,
    validation: {
      isValid: issues.length === 0,
      issues,
    },
  };
}

export function validateOpenUiSource(source: string): OpenUiValidationResult {
  return validateOpenUiSourceWithContext(source).validation;
}
