import { collectTopLevelStatements, type OpenUiTopLevelStatement } from '@kitto-openui/shared/openuiAst.js';
import { visitOpenUiValue } from '#backend/prompts/openui/quality/astWalk.js';
import {
  extractPathLiteral,
  extractStringLiteral,
  isElementNode,
  parser,
  type ToolAst,
} from '#backend/prompts/openui/quality/shared.js';

const MAX_INVENTORY_LENGTH = 4_000;
const MAX_VALUE_LENGTH = 120;
const MAX_STATEMENTS = 30;
const MAX_SCREENS = 20;
const MAX_TOOL_STATEMENTS = 25;
const MAX_RUNTIME_STATE = 30;
const MAX_DOMAIN_PATHS = 30;
const RESERVED_RUNTIME_STATE_NAMES = new Set(['$lastChoice']);

function isInventoryStatement(statement: OpenUiTopLevelStatement) {
  const trimmedValueSource = statement.rawValueSource.trimStart();

  return (
    !statement.statementId.startsWith('$') &&
    !trimmedValueSource.startsWith('Query(') &&
    !trimmedValueSource.startsWith('Mutation(')
  );
}

function pushUnique(values: string[], seenValues: Set<string>, value: unknown) {
  if (typeof value !== 'string') {
    return;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue || seenValues.has(trimmedValue)) {
    return;
  }

  seenValues.add(trimmedValue);
  values.push(trimmedValue);
}

function truncateInventoryValue(value: string) {
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 3)}...` : value;
}

function formatInventoryList(values: string[], maxItems: number) {
  if (values.length === 0) {
    return 'none';
  }

  const visibleValues = values.slice(0, maxItems).map(truncateInventoryValue);
  const omittedCount = values.length - visibleValues.length;
  const suffix = omittedCount > 0 ? `, ... +${omittedCount} more` : '';

  return `${visibleValues.join(', ')}${suffix}`;
}

function formatToolCall(statementId: string, toolAst: ToolAst, argsAst: unknown) {
  const toolName = extractStringLiteral(toolAst) ?? 'unknown_tool';
  const path = extractPathLiteral(argsAst);

  return path ? `${statementId} -> ${toolName}(${path})` : `${statementId} -> ${toolName}`;
}

function collectScreenIds(root: unknown) {
  const screenIds: string[] = [];
  const seenScreenIds = new Set<string>();

  visitOpenUiValue(root, (node) => {
    if (!isElementNode(node) || node.typeName !== 'Screen') {
      return;
    }

    pushUnique(screenIds, seenScreenIds, node.props.id);
  });

  return screenIds;
}

function collectRuntimeStateNames(declaredStateNames: string[]) {
  const stateNames: string[] = [];
  const seenStateNames = new Set<string>();

  for (const stateName of declaredStateNames) {
    if (RESERVED_RUNTIME_STATE_NAMES.has(stateName)) {
      continue;
    }

    pushUnique(stateNames, seenStateNames, stateName);
  }

  return stateNames;
}

export function buildCurrentSourceInventory(source: string) {
  const trimmedSource = source.trim();

  if (!trimmedSource) {
    return null;
  }

  try {
    const parseResult = parser.parse(trimmedSource);

    if (parseResult.meta.incomplete || parseResult.meta.errors.length > 0 || !parseResult.root) {
      return null;
    }

    const statements = collectTopLevelStatements(trimmedSource).filter(isInventoryStatement).map((statement) => statement.statementId);
    const screens = collectScreenIds(parseResult.root);
    const queryToolCalls = parseResult.queryStatements.map((query) =>
      formatToolCall(query.statementId, query.toolAST, query.argsAST),
    );
    const mutationToolCalls = parseResult.mutationStatements.map((mutation) =>
      formatToolCall(mutation.statementId, mutation.toolAST, mutation.argsAST),
    );
    const runtimeState = collectRuntimeStateNames(Object.keys(parseResult.stateDeclarations));
    const domainPaths: string[] = [];
    const seenDomainPaths = new Set<string>();

    for (const query of parseResult.queryStatements) {
      pushUnique(domainPaths, seenDomainPaths, extractPathLiteral(query.argsAST));
    }

    for (const mutation of parseResult.mutationStatements) {
      pushUnique(domainPaths, seenDomainPaths, extractPathLiteral(mutation.argsAST));
    }

    const inventory = [
      `statements: ${formatInventoryList(statements, MAX_STATEMENTS)}`,
      `screens: ${formatInventoryList(screens, MAX_SCREENS)}`,
      `queries: ${formatInventoryList(queryToolCalls, MAX_TOOL_STATEMENTS)}`,
      `mutations: ${formatInventoryList(mutationToolCalls, MAX_TOOL_STATEMENTS)}`,
      `runtime_state: ${formatInventoryList(runtimeState, MAX_RUNTIME_STATE)}`,
      `domain_paths: ${formatInventoryList(domainPaths, MAX_DOMAIN_PATHS)}`,
    ].join('\n');

    return inventory.length > MAX_INVENTORY_LENGTH
      ? `${inventory.slice(0, MAX_INVENTORY_LENGTH - 24).trimEnd()}\n... inventory truncated`
      : inventory;
  } catch {
    return null;
  }
}
