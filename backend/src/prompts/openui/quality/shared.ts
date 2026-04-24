import { createParser, type LibraryJSONSchema, type ParseResult } from '@openuidev/lang-core';
import openUiLibrarySchema from '../../../../../shared/openui-library-schema.json' with { type: 'json' };
import type { PromptBuildValidationIssue } from '../types.js';

export const parser = createParser(openUiLibrarySchema as LibraryJSONSchema);

export type ToolAst = ParseResult['queryStatements'][number]['toolAST'] | ParseResult['mutationStatements'][number]['toolAST'];

export type ExpressionAst = {
  args?: ExpressionAst[];
  entries?: Array<[string, ExpressionAst]>;
  k: string;
  n?: string;
  name?: string;
  refType?: string;
  v?: string;
};

export type ActionRunRef = {
  refType: 'mutation' | 'query';
  statementId: string;
};

export type PersistedPathStatementRef = {
  path: string;
  statementId: string;
};

export type OpenUiQualityMetrics = {
  blockGroupCount: number;
  hasThemeStyling: boolean;
  hasValidationRules: boolean;
  screenCount: number;
};

export type OpenUiQualityIssueSeverity = 'blocking-quality' | 'fatal-quality' | 'soft-warning';

export interface OpenUiQualityIssue extends PromptBuildValidationIssue {
  severity: OpenUiQualityIssueSeverity;
  source: 'quality';
}

export const THEME_CONTAINER_TYPE_NAMES = new Set(['AppShell', 'Group', 'Repeater', 'Screen']);

export function normalizeSourceForValidation(source: string) {
  return source.trim();
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

export function extractStringLiteral(toolAst: ToolAst) {
  if (!toolAst || toolAst.k !== 'Str') {
    return null;
  }

  return toolAst.v;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function maskStringLiterals(source: string) {
  let maskedSource = '';
  let activeQuote: '"' | "'" | null = null;
  let isEscaped = false;

  for (const character of source) {
    if (activeQuote) {
      if (isEscaped) {
        isEscaped = false;
        maskedSource += ' ';
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        maskedSource += ' ';
        continue;
      }

      if (character === activeQuote) {
        activeQuote = null;
      }

      maskedSource += ' ';
      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      maskedSource += ' ';
      continue;
    }

    maskedSource += character;
  }

  return maskedSource;
}

export function isElementNode(
  value: unknown,
): value is {
  props: Record<string, unknown>;
  statementId?: string;
  type: 'element';
  typeName: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'element' &&
    'typeName' in value &&
    typeof value.typeName === 'string' &&
    'props' in value &&
    typeof value.props === 'object' &&
    value.props !== null
  );
}

export function isAstNode(value: unknown): value is ExpressionAst {
  return typeof value === 'object' && value !== null && 'k' in value && typeof (value as { k?: unknown }).k === 'string';
}

export function containsRuntimeRef(value: unknown, runtimeRefNames: Set<string>): boolean {
  if (runtimeRefNames.size === 0) {
    return false;
  }

  if (typeof value === 'string') {
    return runtimeRefNames.has(value);
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsRuntimeRef(entry, runtimeRefNames));
  }

  if (!isAstNode(value)) {
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some((entry) => containsRuntimeRef(entry, runtimeRefNames));
    }

    return false;
  }

  if (value.k === 'RuntimeRef' && typeof value.n === 'string' && runtimeRefNames.has(value.n)) {
    return true;
  }

  return Object.values(value).some((entry) => containsRuntimeRef(entry, runtimeRefNames));
}

export function hasThemeDependentContainerAppearance(value: unknown, themeStateNames: Set<string>): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasThemeDependentContainerAppearance(entry, themeStateNames));
  }

  if (!isElementNode(value)) {
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some((entry) => hasThemeDependentContainerAppearance(entry, themeStateNames));
    }

    return false;
  }

  if (
    THEME_CONTAINER_TYPE_NAMES.has(value.typeName) &&
    value.props.appearance != null &&
    containsRuntimeRef(value.props.appearance, themeStateNames)
  ) {
    return true;
  }

  return Object.values(value.props).some((entry) => hasThemeDependentContainerAppearance(entry, themeStateNames));
}

export function collectThemeAppearanceRefNames(source: string) {
  const themeRefNames = new Set(source.match(/\$[\w$]*theme\b/gi) ?? []);

  if (themeRefNames.size === 0) {
    return themeRefNames;
  }

  const topLevelAssignmentPattern = /(^|\n)([A-Za-z_][\w$]*)\s*=\s*([\s\S]*?)(?=\n(?:\$?[A-Za-z_][\w$]*\s*=|root\s*=)|$)/g;
  let match = topLevelAssignmentPattern.exec(source);

  while (match) {
    const statementId = match[2];
    const statementValueSource = match[3] ?? '';

    if (
      typeof statementId === 'string' &&
      statementId !== 'root' &&
      [...themeRefNames].some((themeRefName) => statementValueSource.includes(themeRefName))
    ) {
      themeRefNames.add(statementId);
    }

    match = topLevelAssignmentPattern.exec(source);
  }

  return themeRefNames;
}

export function extractPathLiteral(argsAst: unknown) {
  if (!isAstNode(argsAst) || argsAst.k !== 'Obj' || !Array.isArray(argsAst.entries)) {
    return null;
  }

  const pathEntry = argsAst.entries.find(([key]) => key === 'path');
  const pathValue = pathEntry?.[1];

  return isAstNode(pathValue) && pathValue.k === 'Str' && typeof pathValue.v === 'string' ? pathValue.v : null;
}

export function extractObjectStringLiteral(argsAst: unknown, key: string) {
  if (!isAstNode(argsAst) || argsAst.k !== 'Obj' || !Array.isArray(argsAst.entries)) {
    return null;
  }

  const entry = argsAst.entries.find(([entryKey]) => entryKey === key);
  const value = entry?.[1];

  return isAstNode(value) && value.k === 'Str' && typeof value.v === 'string' ? value.v : null;
}

function splitPersistedPath(path: string) {
  const segments = path.split('.');

  return segments.every((segment) => segment.length > 0) ? segments : [];
}

function isPathPrefix(prefix: string[], value: string[]) {
  return prefix.length <= value.length && prefix.every((segment, index) => value[index] === segment);
}

export function doPathsOverlapByPrefix(leftPath: string, rightPath: string) {
  const leftSegments = splitPersistedPath(leftPath);
  const rightSegments = splitPersistedPath(rightPath);

  if (leftSegments.length === 0 || rightSegments.length === 0) {
    return false;
  }

  return isPathPrefix(leftSegments, rightSegments) || isPathPrefix(rightSegments, leftSegments);
}

export function collectPersistedQueryRefs(result: ParseResult) {
  return result.queryStatements.flatMap((query) => {
    const toolName = extractStringLiteral(query.toolAST);
    const path = extractPathLiteral(query.argsAST);

    if (toolName !== 'read_state' || !path) {
      return [];
    }

    return [
      {
        path,
        statementId: query.statementId,
      } satisfies PersistedPathStatementRef,
    ];
  });
}

export function collectActionRunRefsFromActionAst(actionAst: unknown): ActionRunRef[] {
  const runRefs: ActionRunRef[] = [];

  function visit(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (isAstNode(node)) {
      if (node.k === 'Comp' && node.name === 'Run') {
        const refNode = Array.isArray(node.args) ? node.args[0] : null;

        if (
          isAstNode(refNode) &&
          refNode.k === 'RuntimeRef' &&
          (refNode.refType === 'mutation' || refNode.refType === 'query') &&
          typeof refNode.n === 'string'
        ) {
          runRefs.push({
            refType: refNode.refType,
            statementId: refNode.n,
          });
        }
      }

      Object.values(node).forEach(visit);
      return;
    }

    if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach(visit);
    }
  }

  visit(actionAst);
  return runRefs;
}

export function collectActionRunRefGroups(value: unknown): ActionRunRef[][] {
  const actionGroups: ActionRunRef[][] = [];

  function visit(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (isElementNode(node)) {
      Object.values(node.props).forEach(visit);
      return;
    }

    if (isAstNode(node)) {
      if (node.k === 'Comp' && node.name === 'Action') {
        actionGroups.push(collectActionRunRefsFromActionAst(node));
      }

      Object.values(node).forEach(visit);
      return;
    }

    if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach(visit);
    }
  }

  visit(value);
  return actionGroups;
}
