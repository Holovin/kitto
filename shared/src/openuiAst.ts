import type { ASTNode, ElementNode } from '@openuidev/lang-core';

export type OpenUiExpressionAst = ASTNode;

export type OpenUiElementNode = Omit<ElementNode, 'partial'> & Partial<Pick<ElementNode, 'partial'>>;

export type OpenUiToolAst = ASTNode | null;

export type OpenUiToolStatement = {
  argsAST: ASTNode | null;
  statementId: string;
  toolAST: OpenUiToolAst;
};

export type OpenUiParseResultLike = {
  mutationStatements: OpenUiToolStatement[];
  queryStatements: OpenUiToolStatement[];
  root: OpenUiElementNode | null;
  stateDeclarations?: Record<string, unknown>;
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
  maskedValueSource: string;
  rawValueSource: string;
  lineNumber: number;
  statementId: string;
}

export interface OpenUiProgramIndex {
  actionRunRefGroups: OpenUiActionRunRef[][];
  declaredStateRefs: Set<string>;
  mutationToolRefs: OpenUiToolStatementRef[];
  ownedActionRunRefGroups: OpenUiOwnedActionRunRefGroup[];
  persistedQueryRefs: OpenUiPersistedPathStatementRef[];
  queryToolRefs: OpenUiToolStatementRef[];
  statementById: Map<string, OpenUiTopLevelStatement>;
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

export function collectThemeAppearanceRefNamesFromStatements(statements: OpenUiTopLevelStatement[]) {
  const themeRefNames = new Set<string>();

  for (const statement of statements) {
    const matches = statement.maskedValueSource.match(/\$[\w$]*theme\b/gi) ?? [];

    for (const match of matches) {
      themeRefNames.add(match);
    }

    if (/\$[\w$]*theme\b/i.test(statement.statementId)) {
      themeRefNames.add(statement.statementId);
    }
  }

  if (themeRefNames.size === 0) {
    return themeRefNames;
  }

  for (const statement of statements) {
    if (
      statement.statementId !== 'root' &&
      !statement.statementId.startsWith('$') &&
      [...themeRefNames].some((themeRefName) => statement.maskedValueSource.includes(themeRefName))
    ) {
      themeRefNames.add(statement.statementId);
    }
  }

  return themeRefNames;
}

export function collectThemeAppearanceRefNames(source: string) {
  return collectThemeAppearanceRefNamesFromStatements(collectTopLevelStatements(source));
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
  let currentStatementId: string | null = null;
  let currentLineNumber = 0;
  let currentMaskedLines: string[] = [];
  let currentRawLines: string[] = [];

  function flushCurrentStatement() {
    if (!currentStatementId) {
      return;
    }

    const rawValueSource = currentRawLines.join('\n');
    const maskedValueSource = currentMaskedLines.join('\n');

    statements.push({
      expression: rawValueSource.trim(),
      lineNumber: currentLineNumber,
      maskedValueSource,
      rawValueSource,
      statementId: currentStatementId,
    });
  }

  maskedLines.forEach((maskedLine, index) => {
    const match = maskedLine.match(TOP_LEVEL_ASSIGNMENT_LINE_PATTERN);

    if (match) {
      const statementId = match[1];

      if (!statementId) {
        return;
      }

      flushCurrentStatement();
      currentStatementId = statementId;
      currentLineNumber = index + 1;
      currentMaskedLines = [match[2] ?? ''];
      currentRawLines = [rawLines[index]?.replace(TOP_LEVEL_ASSIGNMENT_LINE_PATTERN, '$2') ?? ''];
      return;
    }

    if (!currentStatementId) {
      return;
    }

    currentMaskedLines.push(maskedLine);
    currentRawLines.push(rawLines[index] ?? '');
  });

  flushCurrentStatement();
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

function findMatchingParen(source: string, openParenIndex: number) {
  let depth = 0;
  let activeQuote: '"' | "'" | null = null;
  let isEscaped = false;

  for (let index = openParenIndex; index < source.length; index += 1) {
    const character = source[index];

    if (activeQuote) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        continue;
      }

      if (character === activeQuote) {
        activeQuote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      continue;
    }

    if (character === '(') {
      depth += 1;
      continue;
    }

    if (character !== ')') {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return -1;
}

function splitTopLevelArguments(source: string) {
  const args: string[] = [];
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let activeQuote: '"' | "'" | null = null;
  let isEscaped = false;
  let segmentStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (activeQuote) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        continue;
      }

      if (character === activeQuote) {
        activeQuote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      continue;
    }

    if (character === '(') {
      depthParen += 1;
      continue;
    }

    if (character === ')') {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }

    if (character === '[') {
      depthBracket += 1;
      continue;
    }

    if (character === ']') {
      depthBracket = Math.max(0, depthBracket - 1);
      continue;
    }

    if (character === '{') {
      depthBrace += 1;
      continue;
    }

    if (character === '}') {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }

    if (character !== ',' || depthParen > 0 || depthBracket > 0 || depthBrace > 0) {
      continue;
    }

    args.push(source.slice(segmentStart, index));
    segmentStart = index + 1;
  }

  args.push(source.slice(segmentStart));
  return args;
}

function collectRunRefsFromActionSource(
  source: string,
  resolveRunRefType: (statementId: string) => OpenUiActionRunRef['refType'] | null,
): OpenUiActionRunRef[] {
  const runRefs: OpenUiActionRunRef[] = [];
  const runRefPattern = /@Run\s*\(\s*([A-Za-z_][\w$]*)\s*\)/g;
  let match = runRefPattern.exec(source);

  while (match) {
    const statementId = match[1];

    if (!statementId) {
      match = runRefPattern.exec(source);
      continue;
    }

    const refType = resolveRunRefType(statementId);

    if (!refType) {
      match = runRefPattern.exec(source);
      continue;
    }

    runRefs.push({
      refType,
      statementId,
    });
    match = runRefPattern.exec(source);
  }

  return runRefs;
}

function collectOwnedActionRunRefGroupsFromSourceText(
  source: string,
  resolveRunRefType: (statementId: string) => OpenUiActionRunRef['refType'] | null,
): OpenUiOwnedActionRunRefGroup[] {
  const actionGroups: OpenUiOwnedActionRunRefGroup[] = [];

  function visit(text: string) {
    const componentPattern = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
    let match = componentPattern.exec(text);

    while (match) {
      const typeName = match[1];

      if (!typeName) {
        match = componentPattern.exec(text);
        continue;
      }

      const openParenIndex = text.indexOf('(', match.index + typeName.length);
      const closeParenIndex = openParenIndex >= 0 ? findMatchingParen(text, openParenIndex) : -1;

      if (openParenIndex < 0 || closeParenIndex < 0) {
        break;
      }

      const argsSource = text.slice(openParenIndex + 1, closeParenIndex);
      const args = splitTopLevelArguments(argsSource);
      const actionArg = args.find((arg) => /^\s*Action\s*\(/.test(arg));

      if (actionArg) {
        const actionRunRefs = collectRunRefsFromActionSource(actionArg, resolveRunRefType);

        if (actionRunRefs.length > 0) {
          actionGroups.push({
            ownerTypeName: typeName,
            runRefs: actionRunRefs,
          });
        }
      }

      args.forEach(visit);
      componentPattern.lastIndex = closeParenIndex + 1;
      match = componentPattern.exec(text);
    }
  }

  visit(source);
  return actionGroups;
}

export function createOpenUiProgramIndex(result: OpenUiParseResultLike, source = ''): OpenUiProgramIndex {
  const topLevelStatements = collectTopLevelStatements(source);
  const statementById = new Map(topLevelStatements.map((statement) => [statement.statementId, statement]));
  const runRefTypeByStatementId = new Map<string, OpenUiActionRunRef['refType']>();

  result.queryStatements.forEach((statement) => runRefTypeByStatementId.set(statement.statementId, 'query'));
  result.mutationStatements.forEach((statement) => runRefTypeByStatementId.set(statement.statementId, 'mutation'));

  topLevelStatements.forEach((statement) => {
    if (runRefTypeByStatementId.has(statement.statementId)) {
      return;
    }

    const valueSource = statement.rawValueSource.trimStart();

    if (/^Query\s*\(/.test(valueSource)) {
      runRefTypeByStatementId.set(statement.statementId, 'query');
      return;
    }

    if (/^Mutation\s*\(/.test(valueSource)) {
      runRefTypeByStatementId.set(statement.statementId, 'mutation');
    }
  });

  const resolveRunRefType = (statementId: string) => runRefTypeByStatementId.get(statementId) ?? null;
  const ownedActionRunRefGroups = [
    ...collectOwnedActionRunRefGroups(result.root),
    ...(source ? collectOwnedActionRunRefGroupsFromSourceText(maskStringLiterals(source), resolveRunRefType) : []),
  ];

  return {
    actionRunRefGroups: collectActionRunRefGroups(result.root),
    declaredStateRefs: new Set(
      topLevelStatements
        .filter((statement) => statement.statementId.startsWith('$'))
        .filter((statement) => statement.statementId in (result.stateDeclarations ?? {}))
        .filter((statement) => !isAstNode(result.stateDeclarations?.[statement.statementId]))
        .map((statement) => statement.statementId),
    ),
    mutationToolRefs: collectToolStatementRefs(result.mutationStatements),
    ownedActionRunRefGroups,
    persistedQueryRefs: collectPersistedQueryRefs(result),
    queryToolRefs: collectToolStatementRefs(result.queryStatements),
    statementById,
    topLevelStatements,
  };
}
