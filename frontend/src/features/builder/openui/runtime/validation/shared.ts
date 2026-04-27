import { createParser, type ParseResult } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import type { PromptBuildValidationIssue, BuilderQualityIssueSeverity } from '@features/builder/types';
import type { OpenUiProgramIndex } from '@kitto-openui/shared/openuiAst.js';

export {
  createOpenUiProgramIndex,
  doPathsOverlapByPrefix,
  escapeRegExp,
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
  OpenUiProgramIndex,
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
  issues: PromptBuildValidationIssue[];
}

export interface OpenUiValidationContext {
  normalizedSource: string;
  parseResult: ParseResult | null;
  programIndex: OpenUiProgramIndex | null;
  validation: OpenUiValidationResult;
}

type OpenUiQualityIssueSeverity = BuilderQualityIssueSeverity;

export interface OpenUiQualityIssue extends PromptBuildValidationIssue {
  severity: OpenUiQualityIssueSeverity;
}

export const ACTION_MODE_CHOICE_COMPONENT_NAMES = new Set(['RadioGroup', 'Select']);
export const RESERVED_INLINE_TOOL_CALL_NAMES = new Set(['Mutation', 'Query']);

export function createParserIssue(issue: Omit<PromptBuildValidationIssue, 'source'>): PromptBuildValidationIssue {
  return {
    ...issue,
    source: 'parser',
  };
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

export function mapParserIssues(result: ParseResult): PromptBuildValidationIssue[] {
  return result.meta.errors.map((error) =>
    createParserIssue({
      code: error.code,
      message: error.message,
      statementId: error.statementId,
    }),
  );
}
