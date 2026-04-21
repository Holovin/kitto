import { collectQualityMetrics } from './astWalk';
import { detectControlActionBindingConflicts } from './detectors/controlActionBinding';
import { detectInlineToolCallIssues } from './detectors/inlineToolCall';
import { detectItemBoundControlsWithoutAction } from './detectors/itemBoundControl';
import {
  detectReservedLastChoiceRootIssues,
  detectReservedLastChoiceStatementIssues,
} from './detectors/lastChoiceOutsideAction';
import { detectArrayIndexPathMutationIssues } from './detectors/mutationIndexPath';
import { detectPersistedMutationRefreshWarnings } from './detectors/persistedMutationRefresh';
import { detectRandomResultVisibilityIssues } from './detectors/randomResultVisibility';
import { detectThemeAppearanceIssues } from './detectors/themeAppearance';
import { collectOpenUiParserValidationIssues } from './parser';
import {
  getTodoIssueSeverity,
  hasComputeTools,
  hasRequiredTodoControls,
  isSimplePromptRequest,
  promptRequestsCompute,
  promptRequestsFiltering,
  promptRequestsRandom,
  promptRequestsThemeState,
  promptRequestsTodo,
  promptRequestsValidation,
  promptRequestsVisualStyling,
} from './qualitySignals';
import {
  createOpenUiQualityIssue,
  createParserIssue,
  maskStringLiterals,
  normalizeSourceForValidation,
  parser,
  stripQualityIssueSeverity,
  type OpenUiQualityIssue,
  type OpenUiValidationResult,
} from './shared';
import { appendAutoFixSuggestionIssues, applyOpenUiIssueSuggestions } from './suggestions';

const MAX_SIMPLE_PROMPT_BLOCK_GROUPS = 4;

export { applyOpenUiIssueSuggestions };
export type { OpenUiQualityIssue, OpenUiQualityIssueSeverity, OpenUiValidationResult } from './shared';

export function detectOpenUiQualityIssues(source: string, userPrompt: string): OpenUiQualityIssue[] {
  const trimmedSource = typeof source === 'string' ? normalizeSourceForValidation(source) : '';
  const trimmedPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';

  if (!trimmedSource) {
    return [];
  }

  const result = parser.parse(trimmedSource);

  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root) {
    return [];
  }

  const issues: OpenUiQualityIssue[] = [];
  const maskedSource = maskStringLiterals(trimmedSource);
  const metrics = collectQualityMetrics(result.root);
  const hasPromptContext = trimmedPrompt.length > 0;

  issues.push(...detectControlActionBindingConflicts(result.root));
  issues.push(...detectItemBoundControlsWithoutAction(trimmedSource));
  issues.push(...detectReservedLastChoiceRootIssues(result.root));
  issues.push(...detectReservedLastChoiceStatementIssues(trimmedSource, result));
  issues.push(...detectArrayIndexPathMutationIssues(result));

  if (hasPromptContext && isSimplePromptRequest(trimmedPrompt) && metrics.screenCount > 1) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-too-many-screens',
        message: 'Simple request generated multiple screens.',
      }),
    );
  }

  if (hasPromptContext && isSimplePromptRequest(trimmedPrompt) && metrics.blockGroupCount > MAX_SIMPLE_PROMPT_BLOCK_GROUPS) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-too-many-block-groups',
        message: 'Simple request generated many block groups. Consider fewer sections.',
      }),
    );
  }

  if (
    hasPromptContext &&
    !promptRequestsVisualStyling(trimmedPrompt) &&
    (metrics.hasThemeStyling || /\$[\w$]*theme\b/i.test(maskedSource) || /\btheme\b/i.test(maskedSource))
  ) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-theme',
        message: 'Theme styling was added even though not requested.',
      }),
    );
  }

  if (hasPromptContext && !promptRequestsCompute(trimmedPrompt) && hasComputeTools(result)) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-compute',
        message: 'Compute tools were added even though not requested.',
      }),
    );
  }

  if (hasPromptContext && !promptRequestsFiltering(trimmedPrompt) && /@Filter\s*\(/.test(maskedSource)) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-filter',
        message: 'Filtering was added even though not requested.',
      }),
    );
  }

  if (hasPromptContext && !promptRequestsValidation(trimmedPrompt) && metrics.hasValidationRules) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-validation',
        message: 'Validation rules were added even though not requested.',
      }),
    );
  }

  if (hasPromptContext && promptRequestsTodo(trimmedPrompt) && !hasRequiredTodoControls(result, maskedSource)) {
    issues.push(
      createOpenUiQualityIssue(getTodoIssueSeverity(trimmedPrompt), {
        code: 'quality-missing-todo-controls',
        message: 'Todo request did not generate required todo controls.',
      }),
    );
  }

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

  if (hasPromptContext && promptRequestsRandom(trimmedPrompt)) {
    issues.push(
      ...detectRandomResultVisibilityIssues(result).map((issue) => ({
        ...issue,
        severity: 'blocking-quality' as const,
      })),
    );
  }

  if (hasPromptContext && promptRequestsThemeState(trimmedPrompt)) {
    issues.push(
      ...detectThemeAppearanceIssues(trimmedSource, result).map((issue) => ({
        ...issue,
        severity: 'blocking-quality' as const,
      })),
    );
  }

  return issues;
}

export function detectOpenUiQualityWarnings(source: string, userPrompt: string) {
  return detectOpenUiQualityIssues(source, userPrompt)
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
    ...detectInlineToolCallIssues(result),
  ];
  const issuesWithSuggestions = appendAutoFixSuggestionIssues(trimmedSource, issues);

  return {
    isValid: issuesWithSuggestions.length === 0,
    issues: issuesWithSuggestions,
  };
}
