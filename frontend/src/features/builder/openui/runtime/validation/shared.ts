import { createParser, type ParseResult } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import type { BuilderParseIssue } from '@features/builder/types';

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

export interface OpenUiFunctionCallMatch {
  args: string[];
  text: string;
}

export type ToolAst = ParseResult['queryStatements'][number]['toolAST'] | ParseResult['mutationStatements'][number]['toolAST'];

export interface OpenUiQualityMetrics {
  blockGroupCount: number;
  hasThemeStyling: boolean;
  hasValidationRules: boolean;
  screenCount: number;
}

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

export type OwnedActionRunRefGroup = {
  ownerStatementId?: string;
  ownerTypeName?: string;
  runRefs: ActionRunRef[];
};

export type PersistedPathStatementRef = {
  path: string;
  statementId: string;
};

export type OpenUiQualityIssueSeverity = 'blocking-quality' | 'fatal-quality' | 'soft-warning';

export interface OpenUiQualityIssue extends BuilderParseIssue {
  severity: OpenUiQualityIssueSeverity;
}

export const THEME_CONTAINER_TYPE_NAMES = new Set(['AppShell', 'Group', 'Repeater', 'Screen']);
export const ACTION_MODE_CHOICE_COMPONENT_NAMES = new Set(['RadioGroup', 'Select']);
export const RESERVED_INLINE_TOOL_CALL_NAMES = new Set(['Mutation', 'Query']);

export function normalizeSourceForValidation(source: string) {
  return source.trim();
}

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

export function isLiteralObjectValue(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  if ('k' in value && typeof value.k === 'string') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

export function isAstNode(value: unknown): value is ExpressionAst {
  return typeof value === 'object' && value !== null && 'k' in value && typeof (value as { k?: unknown }).k === 'string';
}

export function isWritableBindingValue(value: unknown) {
  return isAstNode(value) && value.k === 'StateRef';
}

export function hasStateRefNamed(value: unknown, stateName: string): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasStateRefNamed(entry, stateName));
  }

  if (isAstNode(value)) {
    if (value.k === 'StateRef' && value.n === stateName) {
      return true;
    }

    return Object.values(value).some((entry) => hasStateRefNamed(entry, stateName));
  }

  if (isElementNode(value)) {
    return Object.values(value.props).some((entry) => hasStateRefNamed(entry, stateName));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((entry) => hasStateRefNamed(entry, stateName));
  }

  return false;
}

export function extractPathLiteral(argsAst: unknown) {
  if (!isAstNode(argsAst) || argsAst.k !== 'Obj' || !Array.isArray(argsAst.entries)) {
    return null;
  }

  const pathEntry = argsAst.entries.find(([key]) => key === 'path');
  const pathValue = pathEntry?.[1];

  return isAstNode(pathValue) && pathValue.k === 'Str' && typeof pathValue.v === 'string' ? pathValue.v : null;
}

function splitPersistedPath(path: string) {
  const segments = path.split('.');

  return segments.every((segment) => segment.length > 0) ? segments : [];
}

export function pathUsesArrayIndexSegment(path: string) {
  const segments = splitPersistedPath(path);

  return segments.slice(1).some((segment) => /^\d+$/.test(segment));
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

export function collectRefreshablePersistedMutationPaths(result: ParseResult, toolNames: Set<string>) {
  const mutationPathByStatementId = new Map<string, string>();

  for (const mutation of result.mutationStatements) {
    const toolName = extractStringLiteral(mutation.toolAST);
    const path = extractPathLiteral(mutation.argsAST);

    if (!toolName || !path || !toolNames.has(toolName)) {
      continue;
    }

    mutationPathByStatementId.set(mutation.statementId, path);
  }

  return mutationPathByStatementId;
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

export function collectOwnedActionRunRefGroups(value: unknown): OwnedActionRunRefGroup[] {
  const actionGroups: OwnedActionRunRefGroup[] = [];

  function visit(
    node: unknown,
    owner?: {
      statementId?: string;
      typeName: string;
    },
  ) {
    if (Array.isArray(node)) {
      node.forEach((entry) => visit(entry, owner));
      return;
    }

    if (isElementNode(node)) {
      const nextOwner = {
        statementId: node.statementId ?? owner?.statementId,
        typeName: node.typeName,
      };

      Object.values(node.props).forEach((entry) => visit(entry, nextOwner));
      return;
    }

    if (isAstNode(node)) {
      if (node.k === 'Comp' && node.name === 'Action') {
        actionGroups.push({
          ownerStatementId: owner?.statementId,
          ownerTypeName: owner?.typeName,
          runRefs: collectActionRunRefsFromActionAst(node),
        });
      }

      Object.values(node).forEach((entry) => visit(entry, owner));
      return;
    }

    if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach((entry) => visit(entry, owner));
    }
  }

  visit(value);
  return actionGroups;
}
