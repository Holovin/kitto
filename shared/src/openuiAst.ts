export type OpenUiExpressionAst = {
  args?: unknown[];
  entries?: Array<[string, unknown]>;
  k: string;
  n?: string;
  name?: string;
  refType?: string;
  v?: unknown;
};

export type OpenUiElementNode = {
  props: Record<string, unknown>;
  statementId?: string;
  type: 'element';
  typeName: string;
};

export type OpenUiToolAst = unknown;

export type OpenUiToolStatement = {
  argsAST: unknown;
  statementId: string;
  toolAST: OpenUiToolAst;
};

export type OpenUiParseResultLike = {
  mutationStatements: OpenUiToolStatement[];
  queryStatements: OpenUiToolStatement[];
  root: unknown;
};

export type OpenUiVisitContext = {
  statementId?: string;
};

export type OpenUiQualityMetrics = {
  blockGroupCount: number;
  hasFilterUsage: boolean;
  hasThemeStyling: boolean;
  hasValidationRules: boolean;
  screenCount: number;
};

export type OpenUiActionRunRef = {
  refType: 'mutation' | 'query';
  statementId: string;
};

export type OpenUiOwnedActionRunRefGroup = {
  ownerStatementId?: string;
  ownerTypeName?: string;
  runRefs: OpenUiActionRunRef[];
};

export type OpenUiPersistedPathStatementRef = {
  path: string;
  statementId: string;
};

export type OpenUiToolStatementRef = OpenUiPersistedPathStatementRef & {
  toolName: string;
};

export interface OpenUiTopLevelStatement {
  expression: string;
  lineNumber: number;
  statementId: string;
}

export interface OpenUiProgramIndex {
  actionRunRefGroups: OpenUiActionRunRef[][];
  mutationToolRefs: OpenUiToolStatementRef[];
  ownedActionRunRefGroups: OpenUiOwnedActionRunRefGroup[];
  persistedQueryRefs: OpenUiPersistedPathStatementRef[];
  queryToolRefs: OpenUiToolStatementRef[];
  topLevelStatements: OpenUiTopLevelStatement[];
}

const TOP_LEVEL_ASSIGNMENT_LINE_PATTERN = /^(\$?[A-Za-z_][\w$]*)\s*=\s*(.*)$/;

export const THEME_CONTAINER_TYPE_NAMES = new Set(['AppShell', 'Group', 'Repeater', 'Screen']);

export function normalizeSourceForValidation(source: string) {
  return source.trim();
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

export function isElementNode(value: unknown): value is OpenUiElementNode {
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

export function isAstNode(value: unknown): value is OpenUiExpressionAst {
  return typeof value === 'object' && value !== null && 'k' in value && typeof (value as { k?: unknown }).k === 'string';
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

export function extractStringLiteral(toolAst: OpenUiToolAst) {
  if (!isAstNode(toolAst) || toolAst.k !== 'Str') {
    return null;
  }

  return typeof toolAst.v === 'string' ? toolAst.v : null;
}

export function extractObjectStringLiteral(argsAst: unknown, key: string) {
  if (!isAstNode(argsAst) || argsAst.k !== 'Obj' || !Array.isArray(argsAst.entries)) {
    return null;
  }

  const entry = argsAst.entries.find(([entryKey]) => entryKey === key);
  const value = entry?.[1];

  return isAstNode(value) && value.k === 'Str' && typeof value.v === 'string' ? value.v : null;
}

export function extractPathLiteral(argsAst: unknown) {
  return extractObjectStringLiteral(argsAst, 'path');
}

function splitPersistedPath(path: string) {
  const segments = path.split('.');

  return segments.every((segment) => segment.length > 0) ? segments : [];
}

function isPathPrefix(prefix: string[], value: string[]) {
  return prefix.length <= value.length && prefix.every((segment, index) => value[index] === segment);
}

export function pathUsesArrayIndexSegment(path: string) {
  const segments = splitPersistedPath(path);

  return segments.slice(1).some((segment) => /^\d+$/.test(segment));
}

export function doPathsOverlapByPrefix(leftPath: string, rightPath: string) {
  const leftSegments = splitPersistedPath(leftPath);
  const rightSegments = splitPersistedPath(rightPath);

  if (leftSegments.length === 0 || rightSegments.length === 0) {
    return false;
  }

  return isPathPrefix(leftSegments, rightSegments) || isPathPrefix(rightSegments, leftSegments);
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

export function visitOpenUiValue(
  value: unknown,
  visitor: (node: unknown, context: OpenUiVisitContext) => void,
  inheritedStatementId?: string,
) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      visitOpenUiValue(entry, visitor, inheritedStatementId);
    }

    return;
  }

  if (isElementNode(value)) {
    const statementId = value.statementId ?? inheritedStatementId;
    visitor(value, { statementId });

    for (const nestedValue of Object.values(value.props)) {
      visitOpenUiValue(nestedValue, visitor, statementId);
    }

    return;
  }

  if (isAstNode(value)) {
    visitor(value, { statementId: inheritedStatementId });

    for (const nestedValue of Object.values(value)) {
      visitOpenUiValue(nestedValue, visitor, inheritedStatementId);
    }

    return;
  }

  if (typeof value === 'object' && value !== null) {
    visitor(value, { statementId: inheritedStatementId });

    for (const nestedValue of Object.values(value)) {
      visitOpenUiValue(nestedValue, visitor, inheritedStatementId);
    }
  }
}

export function collectQualityMetrics(value: unknown): OpenUiQualityMetrics {
  const metrics: OpenUiQualityMetrics = {
    blockGroupCount: 0,
    hasFilterUsage: false,
    hasThemeStyling: false,
    hasValidationRules: false,
    screenCount: 0,
  };

  visitOpenUiValue(value, (node) => {
    if (isAstNode(node) && node.k === 'Comp' && node.name === 'Filter') {
      metrics.hasFilterUsage = true;
    }

    if (!isElementNode(node)) {
      return;
    }

    if (node.typeName === 'Screen') {
      metrics.screenCount += 1;
    }

    if (node.typeName === 'Group' && node.props.variant !== 'inline') {
      metrics.blockGroupCount += 1;
    }

    if (node.props.appearance != null) {
      metrics.hasThemeStyling = true;
    }

    if (Array.isArray(node.props.validation) ? node.props.validation.length > 0 : node.props.validation != null) {
      metrics.hasValidationRules = true;
    }
  });

  return metrics;
}

export function collectTopLevelStatements(source: string): OpenUiTopLevelStatement[] {
  const maskedLines = maskStringLiterals(source).split('\n');
  const rawLines = source.split('\n');
  const statements: OpenUiTopLevelStatement[] = [];

  maskedLines.forEach((maskedLine, index) => {
    const trimmedLine = maskedLine.trim();
    const match = trimmedLine.match(TOP_LEVEL_ASSIGNMENT_LINE_PATTERN);

    if (!match) {
      return;
    }

    const statementId = match[1];

    if (!statementId) {
      return;
    }

    statements.push({
      expression: rawLines[index]?.trim() ?? '',
      lineNumber: index + 1,
      statementId,
    });
  });

  return statements;
}

export function collectToolStatementRefs(statements: OpenUiToolStatement[]): OpenUiToolStatementRef[] {
  return statements.flatMap((statement) => {
    const toolName = extractStringLiteral(statement.toolAST);
    const path = extractPathLiteral(statement.argsAST);

    if (!toolName || !path) {
      return [];
    }

    return [
      {
        path,
        statementId: statement.statementId,
        toolName,
      },
    ];
  });
}

export function collectPersistedQueryRefs(result: Pick<OpenUiParseResultLike, 'queryStatements'>) {
  return collectToolStatementRefs(result.queryStatements).flatMap((query) => {
    if (query.toolName !== 'read_state') {
      return [];
    }

    return [
      {
        path: query.path,
        statementId: query.statementId,
      },
    ];
  });
}

export function collectRefreshablePersistedMutationPaths(result: Pick<OpenUiParseResultLike, 'mutationStatements'>, toolNames: Set<string>) {
  const mutationPathByStatementId = new Map<string, string>();

  for (const mutation of collectToolStatementRefs(result.mutationStatements)) {
    if (!toolNames.has(mutation.toolName)) {
      continue;
    }

    mutationPathByStatementId.set(mutation.statementId, mutation.path);
  }

  return mutationPathByStatementId;
}

export function collectActionRunRefsFromActionAst(actionAst: unknown): OpenUiActionRunRef[] {
  const runRefs: OpenUiActionRunRef[] = [];

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

export function collectActionRunRefGroups(value: unknown): OpenUiActionRunRef[][] {
  const actionGroups: OpenUiActionRunRef[][] = [];

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

export function collectOwnedActionRunRefGroups(value: unknown): OpenUiOwnedActionRunRefGroup[] {
  const actionGroups: OpenUiOwnedActionRunRefGroup[] = [];

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

export function createOpenUiProgramIndex(result: OpenUiParseResultLike, source = ''): OpenUiProgramIndex {
  return {
    actionRunRefGroups: collectActionRunRefGroups(result.root),
    mutationToolRefs: collectToolStatementRefs(result.mutationStatements),
    ownedActionRunRefGroups: collectOwnedActionRunRefGroups(result.root),
    persistedQueryRefs: collectPersistedQueryRefs(result),
    queryToolRefs: collectToolStatementRefs(result.queryStatements),
    topLevelStatements: collectTopLevelStatements(source),
  };
}
