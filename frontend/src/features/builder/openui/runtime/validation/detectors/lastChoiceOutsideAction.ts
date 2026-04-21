import type { ParseResult } from '@openuidev/react-lang';
import { ACTION_MODE_LAST_CHOICE_STATE } from '@features/builder/openui/library/components/shared';
import {
  ACTION_MODE_CHOICE_COMPONENT_NAMES,
  type ActionRunRef,
  THEME_CONTAINER_TYPE_NAMES,
  collectOwnedActionRunRefGroups,
  createOpenUiQualityIssue,
  hasStateRefNamed,
  isAstNode,
  isElementNode,
  maskStringLiterals,
  type OwnedActionRunRefGroup,
  type OpenUiQualityIssue,
} from '../shared';

function createReservedLastChoiceIssue(statementId?: string): OpenUiQualityIssue {
  return createOpenUiQualityIssue('blocking-quality', {
    code: 'reserved-last-choice-outside-action-mode',
    message:
      '`$lastChoice` is reserved for Select/RadioGroup action mode. Use it only inside those Action([...]) flows or the top-level Mutation(...) / Query(...) statements they run.',
    statementId,
  });
}

function findMatchingParen(source: string, openParenIndex: number) {
  let depth = 0;

  for (let index = openParenIndex; index < source.length; index += 1) {
    const character = source[index];

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
  let segmentStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

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

function collectRunRefsFromActionSource(source: string): ActionRunRef[] {
  const runRefs: ActionRunRef[] = [];
  const runRefPattern = /@Run\s*\(\s*([A-Za-z_][\w$]*)\s*\)/g;
  let match = runRefPattern.exec(source);

  while (match) {
    runRefs.push({
      refType: 'mutation',
      statementId: match[1],
    });
    match = runRefPattern.exec(source);
  }

  return runRefs;
}

function collectOwnedActionRunRefGroupsFromSourceText(source: string): OwnedActionRunRefGroup[] {
  const actionGroups: OwnedActionRunRefGroup[] = [];

  function visit(text: string) {
    const componentPattern = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
    let match = componentPattern.exec(text);

    while (match) {
      const typeName = match[1];
      const openParenIndex = text.indexOf('(', match.index + typeName.length);
      const closeParenIndex = openParenIndex >= 0 ? findMatchingParen(text, openParenIndex) : -1;

      if (openParenIndex < 0 || closeParenIndex < 0) {
        break;
      }

      const argsSource = text.slice(openParenIndex + 1, closeParenIndex);
      const args = splitTopLevelArguments(argsSource);
      const actionArg = args.find((arg) => /^\s*Action\s*\(/.test(arg));

      if (actionArg) {
        const actionRunRefs = collectRunRefsFromActionSource(actionArg);

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

export function detectReservedLastChoiceRootIssues(
  value: unknown,
  inheritedStatementId?: string,
  allowLastChoice = false,
  seenIssueKeys: Set<string> = new Set(),
): OpenUiQualityIssue[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      detectReservedLastChoiceRootIssues(entry, inheritedStatementId, allowLastChoice, seenIssueKeys),
    );
  }

  if (isElementNode(value)) {
    const statementId = value.statementId ?? inheritedStatementId;
    const isActionModeChoiceComponent = ACTION_MODE_CHOICE_COMPONENT_NAMES.has(value.typeName) && value.props.action != null;

    return Object.entries(value.props).flatMap(([propName, propValue]) =>
      detectReservedLastChoiceRootIssues(
        propValue,
        statementId,
        propName === 'action' && isActionModeChoiceComponent,
        seenIssueKeys,
      ),
    );
  }

  if (isAstNode(value)) {
    if (value.k === 'StateRef' && value.n === ACTION_MODE_LAST_CHOICE_STATE && !allowLastChoice) {
      const issueKey = inheritedStatementId ?? 'root';

      if (seenIssueKeys.has(issueKey)) {
        return [];
      }

      seenIssueKeys.add(issueKey);
      return [createReservedLastChoiceIssue(inheritedStatementId)];
    }

    return Object.values(value).flatMap((entry) =>
      detectReservedLastChoiceRootIssues(entry, inheritedStatementId, allowLastChoice, seenIssueKeys),
    );
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap((entry) =>
      detectReservedLastChoiceRootIssues(entry, inheritedStatementId, allowLastChoice, seenIssueKeys),
    );
  }

  return [];
}

export function detectReservedLastChoiceStatementIssues(source: string, result: ParseResult): OpenUiQualityIssue[] {
  const issues: OpenUiQualityIssue[] = [];
  const seenIssueKeys = new Set<string>();
  const maskedSource = maskStringLiterals(source);
  const actionGroups = [
    ...collectOwnedActionRunRefGroups(result.root),
    ...collectOwnedActionRunRefGroupsFromSourceText(maskedSource),
  ];
  const ownerTypesByStatementId = new Map<string, Set<string>>();
  const knownStatementIds = new Set<string>([
    'root',
    ...result.queryStatements.map((statement) => statement.statementId),
    ...result.mutationStatements.map((statement) => statement.statementId),
  ]);

  for (const actionGroup of actionGroups) {
    for (const runRef of actionGroup.runRefs) {
      const ownerTypes = ownerTypesByStatementId.get(runRef.statementId) ?? new Set<string>();

      if (typeof actionGroup.ownerTypeName === 'string') {
        ownerTypes.add(actionGroup.ownerTypeName);
      }

      ownerTypesByStatementId.set(runRef.statementId, ownerTypes);
    }
  }

  const statementsToCheck = [
    ...result.queryStatements.map((statement) => ({
      statementId: statement.statementId,
      value: [statement.toolAST, statement.argsAST, statement.defaultsAST, statement.refreshAST],
    })),
    ...result.mutationStatements.map((statement) => ({
      statementId: statement.statementId,
      value: [statement.toolAST, statement.argsAST],
    })),
  ];

  for (const statement of statementsToCheck) {
    if (!hasStateRefNamed(statement.value, ACTION_MODE_LAST_CHOICE_STATE)) {
      continue;
    }

    const ownerTypes = ownerTypesByStatementId.get(statement.statementId) ?? new Set<string>();
    const hasAllowedOwner = [...ownerTypes].some((ownerType) => ACTION_MODE_CHOICE_COMPONENT_NAMES.has(ownerType));
    const hasDisallowedOwner = [...ownerTypes].some(
      (ownerType) => !ACTION_MODE_CHOICE_COMPONENT_NAMES.has(ownerType) && !THEME_CONTAINER_TYPE_NAMES.has(ownerType),
    );

    if (hasAllowedOwner && !hasDisallowedOwner) {
      continue;
    }

    if (seenIssueKeys.has(statement.statementId)) {
      continue;
    }

    seenIssueKeys.add(statement.statementId);
    issues.push(createReservedLastChoiceIssue(statement.statementId));
  }

  const topLevelAssignmentPattern = /(^|\n)(\$?[A-Za-z_][\w$]*)\s*=\s*([\s\S]*?)(?=\n(?:\$?[A-Za-z_][\w$]*\s*=|root\s*=)|$)/g;
  let match = topLevelAssignmentPattern.exec(maskedSource);

  while (match) {
    const statementId = match[2];
    const statementValueSource = match[3] ?? '';

    if (
      !statementValueSource.includes(ACTION_MODE_LAST_CHOICE_STATE) ||
      knownStatementIds.has(statementId) ||
      seenIssueKeys.has(statementId)
    ) {
      match = topLevelAssignmentPattern.exec(maskedSource);
      continue;
    }

    seenIssueKeys.add(statementId);
    issues.push(createReservedLastChoiceIssue(statementId));
    match = topLevelAssignmentPattern.exec(maskedSource);
  }

  return issues;
}
