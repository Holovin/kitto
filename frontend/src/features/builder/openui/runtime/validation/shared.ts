import { createParser, type ParseResult } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import type { BuilderParseIssue, BuilderQualityIssueSeverity } from '@features/builder/types';
import type { OpenUiProgramIndex } from '@kitto-openui/shared/openuiAst.js';

export {
  collectActionRunRefGroups,
  collectActionRunRefsFromActionAst,
  collectOwnedActionRunRefGroups,
  collectPersistedQueryRefs,
  collectRefreshablePersistedMutationPaths,
  collectTopLevelStatements,
  createOpenUiProgramIndex,
  doPathsOverlapByPrefix,
  escapeRegExp,
  extractObjectStringLiteral,
  extractPathLiteral,
  extractStringLiteral,
  hasStateRefNamed,
  isAstNode,
  isElementNode,
  isLiteralObjectValue,
  isWritableBindingValue,
  maskStringLiterals,
  normalizeSourceForValidation,
  pathUsesArrayIndexSegment,
  THEME_CONTAINER_TYPE_NAMES,
  visitOpenUiValue,
} from '@kitto-openui/shared/openuiAst.js';
export type {
  OpenUiActionRunRef as ActionRunRef,
  OpenUiExpressionAst as ExpressionAst,
  OpenUiOwnedActionRunRefGroup as OwnedActionRunRefGroup,
  OpenUiPersistedPathStatementRef as PersistedPathStatementRef,
  OpenUiProgramIndex,
  OpenUiQualityMetrics,
  OpenUiTopLevelStatement,
} from '@kitto-openui/shared/openuiAst.js';

const openUiJsonSchema = builderOpenUiLibrary.toJSONSchema();

export const parser = createParser(openUiJsonSchema);
export const componentSchemaDefinitions = (openUiJsonSchema.$defs ?? {}) as Record<
  string,
  {
    properties?: Record<
      string,
      {
        enum?: unknown[];
      }
    >;
  }
>;

export interface OpenUiValidationResult {
  isValid: boolean;
  issues: BuilderParseIssue[];
}

export interface OpenUiValidationContext {
  normalizedSource: string;
  parseResult: ParseResult | null;
  programIndex: OpenUiProgramIndex | null;
  validation: OpenUiValidationResult;
}

export interface OpenUiFunctionCallMatch {
  args: string[];
  text: string;
}

export type ToolAst = ParseResult['queryStatements'][number]['toolAST'] | ParseResult['mutationStatements'][number]['toolAST'];
export type OpenUiQualityIssueSeverity = BuilderQualityIssueSeverity;

export interface OpenUiQualityIssue extends BuilderParseIssue {
  severity: OpenUiQualityIssueSeverity;
}

export const ACTION_MODE_CHOICE_COMPONENT_NAMES = new Set(['RadioGroup', 'Select']);
export const RESERVED_INLINE_TOOL_CALL_NAMES = new Set(['Mutation', 'Query']);

export function createParserIssue(issue: Omit<BuilderParseIssue, 'source'>): BuilderParseIssue {
  return {
    ...issue,
    source: 'parser',
  };
}

export function createQualityIssue(issue: Omit<BuilderParseIssue, 'source'>): BuilderParseIssue {
  return {
    ...issue,
    source: 'quality',
  };
}

export function createOpenUiQualityIssue(
  severity: OpenUiQualityIssueSeverity,
  issue: Omit<BuilderParseIssue, 'source'>,
): OpenUiQualityIssue {
  return {
    ...issue,
    severity,
    source: 'quality',
  };
}

export function mapParserIssues(result: ParseResult): BuilderParseIssue[] {
  return result.meta.errors.map((error) =>
    createParserIssue({
      code: error.code,
      message: error.message,
      statementId: error.statementId,
    }),
  );
}
