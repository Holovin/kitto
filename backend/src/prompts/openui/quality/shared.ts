import { createParser, type LibraryJSONSchema, type ParseResult } from '@openuidev/lang-core';
import openUiLibrarySchema from '@kitto-openui/shared/openui-library-schema.json' with { type: 'json' };
import type { BuilderQualityIssueSeverity } from '@kitto-openui/shared/builderApiContract.js';
import type { PromptBuildValidationIssue } from '#backend/prompts/openui/types.js';

export {
  collectActionRunRefGroups,
  collectPersistedQueryRefs,
  collectThemeAppearanceRefNamesFromStatements,
  createOpenUiProgramIndex,
  doPathsOverlapByPrefix,
  extractObjectStringLiteral,
  extractPathLiteral,
  extractStringLiteral,
  hasThemeDependentContainerAppearance,
  isElementNode,
  maskStringLiterals,
  normalizeSourceForValidation,
} from '@kitto-openui/shared/openuiAst.js';
export type {
  OpenUiPersistedPathStatementRef as PersistedPathStatementRef,
  OpenUiProgramIndex,
} from '@kitto-openui/shared/openuiAst.js';

export const parser = createParser(openUiLibrarySchema as LibraryJSONSchema);

export type ToolAst = ParseResult['queryStatements'][number]['toolAST'] | ParseResult['mutationStatements'][number]['toolAST'];
export type OpenUiQualityIssueSeverity = BuilderQualityIssueSeverity;

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
