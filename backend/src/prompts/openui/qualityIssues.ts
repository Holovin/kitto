import { collectQualityMetrics } from '#backend/prompts/openui/quality/astWalk.js';
import { detectRandomResultVisibilityIssues } from '#backend/prompts/openui/quality/detectors/randomResultVisibility.js';
import { detectThemeAppearanceIssues } from '#backend/prompts/openui/quality/detectors/themeAppearance.js';
import {
  createOpenUiQualityIssue,
  createOpenUiProgramIndex,
  maskStringLiterals,
  parser,
  stripQualityIssueSeverity,
  type BuilderQualityIssue,
} from '#backend/prompts/openui/quality/shared.js';
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

type PromptAwareGenerationMode = 'initial' | 'repair';

type SourceFeatureFlags = {
  compute: boolean;
  filter: boolean;
  theme: boolean;
  validation: boolean;
};

type OpenUiParseResult = ReturnType<typeof parser.parse>;

function collectParsedSourceQualityProfile(parseResult: OpenUiParseResult) {
  if (parseResult.meta.incomplete || parseResult.meta.errors.length > 0 || !parseResult.root) {
    return null;
  }

  const metrics = collectQualityMetrics(parseResult.root);

  return {
    featureFlags: {
      compute: hasComputeTools(parseResult),
      filter: metrics.hasFilterUsage,
      theme: metrics.hasThemeStyling,
      validation: metrics.hasValidationRules,
    },
    metrics,
  };
}

function collectSourceFeatureFlags(source: string): SourceFeatureFlags | null {
  return collectParsedSourceQualityProfile(parser.parse(source))?.featureFlags ?? null;
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
): BuilderQualityIssue[] {
  const trimmedSource = source.trim();
  const trimmedPrompt = userPrompt.trim();
  const trimmedCurrentSource = currentSource ? currentSource.trim() : '';
  const compareAgainstBaseline = mode === 'repair' ? true : trimmedCurrentSource.length > 0;

  if (!trimmedSource) {
    return [];
  }

  const result = parser.parse(trimmedSource);
  const nextSourceProfile = collectParsedSourceQualityProfile(result);

  if (!nextSourceProfile || trimmedPrompt.length === 0) {
    return [];
  }

  const issues: BuilderQualityIssue[] = [];
  const maskedSource = maskStringLiterals(trimmedSource);
  const programIndex = createOpenUiProgramIndex(result, trimmedSource);
  const { featureFlags: nextFeatureFlags, metrics } = nextSourceProfile;
  const currentFeatureFlags = compareAgainstBaseline ? collectSourceFeatureFlags(trimmedCurrentSource) : null;

  issues.push(...detectChoiceOptionsShapeIssues(programIndex));

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
      ...detectThemeAppearanceIssues(result, programIndex).map((issue) => ({
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
