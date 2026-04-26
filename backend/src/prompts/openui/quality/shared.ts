import { createParser, type LibraryJSONSchema, type ParseResult } from '@openuidev/lang-core';
import openUiLibrarySchema from '@kitto-openui/shared/openui-library-schema.json' with { type: 'json' };
import type { PromptBuildValidationIssue } from '#backend/prompts/openui/types.js';

export {
  collectActionRunRefGroups,
  collectActionRunRefsFromActionAst,
  collectPersistedQueryRefs,
  collectThemeAppearanceRefNames,
  containsRuntimeRef,
  createOpenUiProgramIndex,
  doPathsOverlapByPrefix,
  escapeRegExp,
  extractObjectStringLiteral,
  extractPathLiteral,
  extractStringLiteral,
  hasThemeDependentContainerAppearance,
  isAstNode,
  isElementNode,
  maskStringLiterals,
  normalizeSourceForValidation,
  THEME_CONTAINER_TYPE_NAMES,
  visitOpenUiValue,
} from '@kitto-openui/shared/openuiAst.js';
export type {
  OpenUiActionRunRef as ActionRunRef,
  OpenUiExpressionAst as ExpressionAst,
  OpenUiPersistedPathStatementRef as PersistedPathStatementRef,
  OpenUiProgramIndex,
  OpenUiQualityMetrics,
} from '@kitto-openui/shared/openuiAst.js';

export const parser = createParser(openUiLibrarySchema as LibraryJSONSchema);

export type ToolAst = ParseResult['queryStatements'][number]['toolAST'] | ParseResult['mutationStatements'][number]['toolAST'];
export type OpenUiQualityIssueSeverity = 'blocking-quality' | 'fatal-quality' | 'soft-warning';

export interface OpenUiQualityIssue extends PromptBuildValidationIssue {
  severity: OpenUiQualityIssueSeverity;
  source: 'quality';
}

export function createQualityIssue(issue: Omit<PromptBuildValidationIssue, 'source'>): PromptBuildValidationIssue {
  return {
    ...issue,
    source: 'quality',
  };
}

export function createOpenUiQualityIssue(
  severity: OpenUiQualityIssueSeverity,
  issue: Omit<PromptBuildValidationIssue, 'source'>,
): OpenUiQualityIssue {
  return {
    ...issue,
    severity,
    source: 'quality',
  };
}

export function stripQualityIssueSeverity(issue: OpenUiQualityIssue): PromptBuildValidationIssue {
  const strippedIssue: PromptBuildValidationIssue = {
    code: issue.code,
    message: issue.message,
    source: issue.source,
  };

  if (issue.context) {
    strippedIssue.context = issue.context;
  }

  if (issue.statementId) {
    strippedIssue.statementId = issue.statementId;
  }

  if (issue.suggestion) {
    strippedIssue.suggestion = issue.suggestion;
  }

  return strippedIssue;
}
