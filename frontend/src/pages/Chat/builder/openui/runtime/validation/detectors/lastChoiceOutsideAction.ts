import type { ParseResult } from '@openuidev/react-lang';
import { ACTION_MODE_LAST_CHOICE_STATE } from '@pages/Chat/builder/openui/library/components/shared';
import {
  ACTION_MODE_CHOICE_COMPONENT_NAMES,
  THEME_CONTAINER_TYPE_NAMES,
  createOpenUiQualityIssue,
  hasStateRefNamed,
  isAstNode,
  isElementNode,
  type OpenUiProgramIndex,
  type BuilderQualityIssue,
} from '@pages/Chat/builder/openui/runtime/validation/shared';

function createReservedLastChoiceIssue(statementId?: string): BuilderQualityIssue {
  return createOpenUiQualityIssue('blocking-quality', {
    code: 'reserved-last-choice-outside-action-mode',
    message:
      '`$lastChoice` is reserved for Select/RadioGroup action mode. Use it only inside those Action([...]) flows or the top-level Mutation(...) / Query(...) statements they run.',
    statementId,
  });
}

export function detectReservedLastChoiceRootIssues(
  value: unknown,
  inheritedStatementId?: string,
  allowLastChoice = false,
  seenIssueKeys: Set<string> = new Set(),
): BuilderQualityIssue[] {
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

export function detectReservedLastChoiceStatementIssues(result: ParseResult, programIndex: OpenUiProgramIndex): BuilderQualityIssue[] {
  const issues: BuilderQualityIssue[] = [];
  const seenIssueKeys = new Set<string>();
  const actionGroups = programIndex.ownedActionRunRefGroups;
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

  for (const statement of programIndex.topLevelStatements) {
    const { maskedValueSource: statementValueSource, statementId } = statement;

    if (
      !statementValueSource.includes(ACTION_MODE_LAST_CHOICE_STATE) ||
      knownStatementIds.has(statementId) ||
      seenIssueKeys.has(statementId)
    ) {
      continue;
    }

    seenIssueKeys.add(statementId);
    issues.push(createReservedLastChoiceIssue(statementId));
  }

  return issues;
}
