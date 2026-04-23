import { collectQualityMetrics } from './quality/astWalk.js';
import { detectRandomResultVisibilityIssues } from './quality/detectors/randomResultVisibility.js';
import { detectThemeAppearanceIssues } from './quality/detectors/themeAppearance.js';
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
const FILTER_USAGE_PATTERN = /@Filter\s*\(/i;
const THEME_REFERENCE_PATTERN = /\$[\w$]*theme\b/i;
const THEME_KEYWORD_PATTERN = /\btheme\b/i;

type PromptAwareGenerationMode = 'initial' | 'repair';

type SourceFeatureFlags = {
  compute: boolean;
  filter: boolean;
  theme: boolean;
  validation: boolean;
};

function collectSourceFeatureFlags(source: string) {
  const parseResult = parser.parse(source);
  if (parseResult.meta.incomplete || parseResult.meta.errors.length > 0 || !parseResult.root) {
    return null;
  }

  const maskedSource = maskStringLiterals(source);
  const metrics = collectQualityMetrics(parseResult.root);

  return {
    compute: hasComputeTools(parseResult),
    filter: FILTER_USAGE_PATTERN.test(maskedSource),
    theme: metrics.hasThemeStyling || THEME_REFERENCE_PATTERN.test(maskedSource) || THEME_KEYWORD_PATTERN.test(maskedSource),
    validation: metrics.hasValidationRules,
  };
}

function hasRequestUnrequestedNewFeature(
  compareAgainstBaseline: boolean,
  currentFeatureFlag: boolean | undefined,
  nextFeatureFlag: boolean,
) {
  if (!nextFeatureFlag) {
    return false;
  }

  if (!compareAgainstBaseline) {
    return true;
  }

  if (currentFeatureFlag === undefined) {
    return true;
  }

  return !currentFeatureFlag;
}

export function detectPromptAwareQualityIssues(
  source: string,
  userPrompt: string,
  currentSource?: string,
  mode: PromptAwareGenerationMode = 'initial',
): OpenUiQualityIssue[] {
  const trimmedSource = typeof source === 'string' ? normalizeSourceForValidation(source) : '';
  const trimmedPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  const trimmedCurrentSource = typeof currentSource === 'string' ? normalizeSourceForValidation(currentSource) : '';
  const compareAgainstBaseline = mode === 'repair' ? true : trimmedCurrentSource.length > 0;

  if (!trimmedSource) {
    return [];
  }

  const result = parser.parse(trimmedSource);

  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root || trimmedPrompt.length === 0) {
    return [];
  }

  const issues: OpenUiQualityIssue[] = [];
  const maskedSource = maskStringLiterals(trimmedSource);
  const metrics = collectQualityMetrics(result.root);
  const nextFeatureFlags = {
    compute: hasComputeTools(result),
    filter: FILTER_USAGE_PATTERN.test(maskedSource),
    theme: metrics.hasThemeStyling || THEME_REFERENCE_PATTERN.test(maskedSource) || THEME_KEYWORD_PATTERN.test(maskedSource),
    validation: metrics.hasValidationRules,
  };
  const currentFeatureFlags = compareAgainstBaseline ? collectSourceFeatureFlags(trimmedCurrentSource) : null;

  issues.push(...detectChoiceOptionsShapeIssues(trimmedSource));

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
    hasRequestUnrequestedNewFeature(compareAgainstBaseline, currentFeatureFlags?.theme, nextFeatureFlags.theme)
  ) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-theme',
        message: 'Theme styling was added even though not requested.',
      }),
    );
  }

  if (
    !promptRequestsCompute(trimmedPrompt) &&
    hasRequestUnrequestedNewFeature(compareAgainstBaseline, currentFeatureFlags?.compute, nextFeatureFlags.compute)
  ) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-compute',
        message: 'Compute tools were added even though not requested.',
      }),
    );
  }

  if (
    !promptRequestsFiltering(trimmedPrompt) &&
    hasRequestUnrequestedNewFeature(compareAgainstBaseline, currentFeatureFlags?.filter, nextFeatureFlags.filter)
  ) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-filter',
        message: 'Filtering was added even though not requested.',
      }),
    );
  }

  if (
    !promptRequestsValidation(trimmedPrompt) &&
    hasRequestUnrequestedNewFeature(compareAgainstBaseline, currentFeatureFlags?.validation, nextFeatureFlags.validation)
  ) {
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
      ...detectThemeAppearanceIssues(trimmedSource, result).map((issue) => ({
        ...issue,
        severity: 'blocking-quality' as const,
        source: 'quality' as const,
      })),
    );
  }

  return issues;
}

export function detectPromptAwareQualityWarnings(
  source: string,
  userPrompt: string,
  currentSource?: string,
  mode: PromptAwareGenerationMode = 'initial',
) {
  return detectPromptAwareQualityIssues(source, userPrompt, currentSource, mode)
    .filter((issue) => issue.severity === 'soft-warning')
    .map(stripQualityIssueSeverity);
}
