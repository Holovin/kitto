import { collectQualityMetrics } from './quality/astWalk.js';
import { detectRandomResultVisibilityIssues } from './quality/detectors/randomResultVisibility.js';
import { detectThemeAppearanceIssues } from './quality/detectors/themeAppearance.js';
import { applyOpenUiAutoFixSuggestions } from './quality/suggestions.js';
import {
  createOpenUiQualityIssue,
  maskStringLiterals,
  normalizeSourceForValidation,
  parser,
  stripQualityIssueSeverity,
  type OpenUiQualityIssue,
} from './quality/shared.js';
import {
  detectChoiceOptionsShapeIssues,
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
} from './qualitySignals.js';

const MAX_SIMPLE_PROMPT_BLOCK_GROUPS = 4;

export type { OpenUiQualityIssue, OpenUiQualityIssueSeverity } from './quality/shared.js';

export function detectOpenUiQualityIssues(source: string, userPrompt: string): OpenUiQualityIssue[] {
  const trimmedSource = typeof source === 'string' ? normalizeSourceForValidation(source) : '';
  const trimmedPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';

  if (!trimmedSource) {
    return [];
  }

  const preparedSource = applyOpenUiAutoFixSuggestions(trimmedSource);
  const result = parser.parse(preparedSource);

  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root || trimmedPrompt.length === 0) {
    return [];
  }

  const issues: OpenUiQualityIssue[] = [];
  const maskedSource = maskStringLiterals(preparedSource);
  const metrics = collectQualityMetrics(result.root);

  issues.push(...detectChoiceOptionsShapeIssues(preparedSource));

  if (isSimplePromptRequest(trimmedPrompt) && metrics.screenCount > 1) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-too-many-screens',
        message: 'Simple request generated multiple screens.',
      }),
    );
  }

  if (isSimplePromptRequest(trimmedPrompt) && metrics.blockGroupCount > MAX_SIMPLE_PROMPT_BLOCK_GROUPS) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-too-many-block-groups',
        message: 'Simple request generated many block groups. Consider fewer sections.',
      }),
    );
  }

  if (
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

  if (!promptRequestsCompute(trimmedPrompt) && hasComputeTools(result)) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-compute',
        message: 'Compute tools were added even though not requested.',
      }),
    );
  }

  if (!promptRequestsFiltering(trimmedPrompt) && /@Filter\s*\(/.test(maskedSource)) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-filter',
        message: 'Filtering was added even though not requested.',
      }),
    );
  }

  if (!promptRequestsValidation(trimmedPrompt) && metrics.hasValidationRules) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-validation',
        message: 'Validation rules were added even though not requested.',
      }),
    );
  }

  if (promptRequestsTodo(trimmedPrompt) && !hasRequiredTodoControls(result, maskedSource)) {
    issues.push(
      createOpenUiQualityIssue(getTodoIssueSeverity(trimmedPrompt), {
        code: 'quality-missing-todo-controls',
        message: 'Todo request did not generate required todo controls.',
      }),
    );
  }

  if (promptRequestsRandom(trimmedPrompt)) {
    issues.push(
      ...detectRandomResultVisibilityIssues(result).map((issue) => ({
        ...issue,
        severity: 'blocking-quality' as const,
        source: 'quality' as const,
      })),
    );
  }

  if (promptRequestsThemeState(trimmedPrompt)) {
    issues.push(
      ...detectThemeAppearanceIssues(preparedSource, result).map((issue) => ({
        ...issue,
        severity: 'blocking-quality' as const,
        source: 'quality' as const,
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
