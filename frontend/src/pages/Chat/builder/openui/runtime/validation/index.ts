import { detectControlActionBindingConflicts } from '@pages/Chat/builder/openui/runtime/validation/detectors/controlActionBinding';
import { detectInlineToolCallIssues } from '@pages/Chat/builder/openui/runtime/validation/detectors/inlineToolCall';
import { detectItemBoundControlsWithoutAction } from '@pages/Chat/builder/openui/runtime/validation/detectors/itemBoundControl';
import {
  detectReservedLastChoiceRootIssues,
  detectReservedLastChoiceStatementIssues,
} from '@pages/Chat/builder/openui/runtime/validation/detectors/lastChoiceOutsideAction';
import { detectArrayIndexPathMutationIssues } from '@pages/Chat/builder/openui/runtime/validation/detectors/mutationIndexPath';
import { detectChoiceOptionsShapeIssues } from '@pages/Chat/builder/openui/runtime/validation/detectors/optionsShape';
import { detectPersistedMutationRefreshWarnings } from '@pages/Chat/builder/openui/runtime/validation/detectors/persistedMutationRefresh';
import { detectStructuralInvariantIssues } from '@pages/Chat/builder/openui/runtime/validation/detectors/structuralInvariants';
import { detectUndefinedStateReferenceIssues } from '@pages/Chat/builder/openui/runtime/validation/detectors/undefinedStateReference';
import { getOpenUiQualityIssueSeverity } from '@kitto-openui/shared/openuiQualityIssueRegistry.js';
import { collectOpenUiParserValidationIssues } from './parser';
import {
  createParserIssue,
  createOpenUiProgramIndex,
  escapeStringLiteralBackticksForParser,
  maskStringLiterals,
  parser,
  type OpenUiQualityIssue,
  type OpenUiValidationContext,
  type OpenUiValidationResult,
} from './shared';

type LocalRuntimeQualityIssueOptions = Partial<Pick<OpenUiValidationContext, 'normalizedSource' | 'parseResult' | 'programIndex'>> & {
  validationIssues?: OpenUiValidationResult['issues'];
};

function mapKnownValidationQualityIssues(validationIssues?: OpenUiValidationResult['issues']): OpenUiQualityIssue[] | null {
  if (!validationIssues) {
    return null;
  }

  const qualityIssues: OpenUiQualityIssue[] = [];

  for (const issue of validationIssues) {
    const severity = getOpenUiQualityIssueSeverity(issue);

    if (severity) {
      qualityIssues.push({ ...issue, severity });
    }
  }

  return qualityIssues;
}

export function detectLocalRuntimeQualityIssues(
  source: string,
  options: LocalRuntimeQualityIssueOptions = {},
): OpenUiQualityIssue[] {
  const trimmedSource = options.normalizedSource ?? source.trim();

  if (!trimmedSource) {
    return [];
  }

  const result = options.parseResult ?? parser.parse(escapeStringLiteralBackticksForParser(trimmedSource));

  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root) {
    return [];
  }

  const issues: OpenUiQualityIssue[] = [];
  const programIndex = options.programIndex ?? createOpenUiProgramIndex(result, trimmedSource);
  const knownValidationQualityIssues = mapKnownValidationQualityIssues(options.validationIssues);

  issues.push(...detectChoiceOptionsShapeIssues(programIndex));
  issues.push(...detectControlActionBindingConflicts(result.root));
  issues.push(...detectItemBoundControlsWithoutAction(trimmedSource));
  issues.push(...detectReservedLastChoiceRootIssues(result.root));
  issues.push(...detectReservedLastChoiceStatementIssues(result, programIndex));
  issues.push(...detectUndefinedStateReferenceIssues(result, programIndex));
  issues.push(...detectArrayIndexPathMutationIssues(result));

  if (knownValidationQualityIssues) {
    issues.push(...knownValidationQualityIssues);
  } else {
    issues.push(
      ...detectStructuralInvariantIssues(result, programIndex).map((issue) => ({
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
    ...detectPersistedMutationRefreshWarnings(result, programIndex).map((issue) => ({
      ...issue,
      severity: 'blocking-quality' as const,
    })),
  );

  return issues;
}

export function validateOpenUiSourceWithContext(source: string): OpenUiValidationContext {
  const trimmedSource = source.trim();

  if (!trimmedSource) {
    return {
      normalizedSource: trimmedSource,
      parseResult: null,
      programIndex: null,
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

  if (maskStringLiterals(trimmedSource).includes('```')) {
    return {
      normalizedSource: trimmedSource,
      parseResult: null,
      programIndex: null,
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

  const parserSource = escapeStringLiteralBackticksForParser(trimmedSource);
  const result = parser.parse(parserSource);
  const programIndex = createOpenUiProgramIndex(result, trimmedSource);
  const issues = [
    ...collectOpenUiParserValidationIssues(trimmedSource, result),
    ...detectStructuralInvariantIssues(result, programIndex),
    ...detectInlineToolCallIssues(result),
  ];

  return {
    normalizedSource: trimmedSource,
    parseResult: result,
    programIndex,
    validation: {
      isValid: issues.length === 0,
      issues,
    },
  };
}

export function validateOpenUiSource(source: string): OpenUiValidationResult {
  return validateOpenUiSourceWithContext(source).validation;
}
