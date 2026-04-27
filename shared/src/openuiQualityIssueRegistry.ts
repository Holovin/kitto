import {
  BUILDER_QUALITY_ISSUE_SEVERITIES,
  type BuilderQualityIssueSeverity,
} from './builderApiContract.js';

export const OPENUI_QUALITY_ISSUE_SEVERITY_BY_CODE = {
  'app-shell-not-root': 'fatal-quality',
  'multiple-app-shells': 'fatal-quality',
  'repeater-inside-repeater': 'fatal-quality',
  'screen-inside-screen': 'fatal-quality',
  'control-action-and-binding': 'blocking-quality',
  'inline-tool-in-each': 'blocking-quality',
  'inline-tool-in-prop': 'blocking-quality',
  'inline-tool-in-repeater': 'blocking-quality',
  'item-bound-control-without-action': 'blocking-quality',
  'mutation-uses-array-index-path': 'blocking-quality',
  'quality-missing-control-showcase-components': 'blocking-quality',
  'quality-missing-screen-flow': 'blocking-quality',
  'quality-options-shape': 'blocking-quality',
  'quality-random-result-not-visible': 'blocking-quality',
  'quality-stale-persisted-query': 'blocking-quality',
  'quality-theme-state-not-applied': 'blocking-quality',
  'reserved-last-choice-outside-action-mode': 'blocking-quality',
  'undefined-state-reference': 'blocking-quality',
  'quality-too-many-block-groups': 'soft-warning',
  'quality-too-many-screens': 'soft-warning',
  'quality-unrequested-compute': 'soft-warning',
  'quality-unrequested-filter': 'soft-warning',
  'quality-unrequested-theme': 'soft-warning',
  'quality-unrequested-validation': 'soft-warning',
} as const satisfies Record<string, BuilderQualityIssueSeverity>;

export type OpenUiRegisteredQualityIssueCode = keyof typeof OPENUI_QUALITY_ISSUE_SEVERITY_BY_CODE;

interface OpenUiQualityIssueSeverityInput {
  code?: unknown;
  severity?: unknown;
}

const BUILDER_QUALITY_ISSUE_SEVERITY_SET = new Set<BuilderQualityIssueSeverity>(BUILDER_QUALITY_ISSUE_SEVERITIES);

function isBuilderQualityIssueSeverity(value: unknown): value is BuilderQualityIssueSeverity {
  return typeof value === 'string' && BUILDER_QUALITY_ISSUE_SEVERITY_SET.has(value as BuilderQualityIssueSeverity);
}

function getRegisteredOpenUiQualityIssueSeverity(code: string) {
  return OPENUI_QUALITY_ISSUE_SEVERITY_BY_CODE[code as OpenUiRegisteredQualityIssueCode];
}

export function getOpenUiQualityIssueSeverity(
  issue: OpenUiQualityIssueSeverityInput,
): BuilderQualityIssueSeverity | undefined {
  if (isBuilderQualityIssueSeverity(issue.severity)) {
    return issue.severity;
  }

  const code = typeof issue.code === 'string' ? issue.code.trim() : '';

  return code ? getRegisteredOpenUiQualityIssueSeverity(code) : undefined;
}

export function isOpenUiBlockingQualityIssue(issue: OpenUiQualityIssueSeverityInput) {
  return getOpenUiQualityIssueSeverity(issue) === 'blocking-quality';
}
