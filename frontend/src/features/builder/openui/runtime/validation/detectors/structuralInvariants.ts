import type { ParseResult } from '@openuidev/react-lang';
import type { BuilderParseIssue } from '@features/builder/types';
import { visitOpenUiValue } from '@features/builder/openui/runtime/validation/astWalk';
import { createQualityIssue, isAstNode, isElementNode } from '@features/builder/openui/runtime/validation/shared';

const TOP_LEVEL_ASSIGNMENT_LINE_PATTERN = /^(\$?[A-Za-z_][\w$]*)\s*=\s*(.*)$/;

export const FATAL_STRUCTURAL_INVARIANT_CODES = new Set([
  'app-shell-not-root',
  'multiple-app-shells',
  'screen-inside-screen',
  'repeater-inside-repeater',
]);

type TopLevelStatement = {
  rawValueSource: string;
  statementId: string;
};

function collectTopLevelStatements(source: string): TopLevelStatement[] {
  const rawLines = source.split('\n');
  const statements: TopLevelStatement[] = [];
  let currentStatementId: string | null = null;
  let currentRawLines: string[] = [];

  function flushCurrentStatement() {
    if (!currentStatementId) {
      return;
    }

    statements.push({
      statementId: currentStatementId,
      rawValueSource: currentRawLines.join('\n'),
    });
  }

  for (const rawLine of rawLines) {
    const assignmentMatch = rawLine.match(TOP_LEVEL_ASSIGNMENT_LINE_PATTERN);

    if (assignmentMatch) {
      flushCurrentStatement();
      currentStatementId = assignmentMatch[1];
      currentRawLines = [rawLine.replace(TOP_LEVEL_ASSIGNMENT_LINE_PATTERN, '$2')];
      continue;
    }

    if (!currentStatementId) {
      continue;
    }

    currentRawLines.push(rawLine);
  }

  flushCurrentStatement();
  return statements;
}

function isComponentNode(value: unknown, typeName: string) {
  return (
    (isElementNode(value) && value.typeName === typeName) ||
    (isAstNode(value) && value.k === 'Comp' && value.name === typeName)
  );
}

function getComponentChildren(value: unknown) {
  if (isElementNode(value)) {
    return value.props.children;
  }

  if (isAstNode(value) && value.k === 'Comp') {
    const mappedProps = 'mappedProps' in value ? (value as { mappedProps?: Record<string, unknown> }).mappedProps : undefined;
    return mappedProps?.children;
  }

  return undefined;
}

function pushUniqueIssue(
  issues: BuilderParseIssue[],
  seenIssueKeys: Set<string>,
  code: string,
  message: string,
  statementId?: string,
) {
  const issueKey = `${code}:${statementId ?? 'global'}`;

  if (seenIssueKeys.has(issueKey)) {
    return;
  }

  seenIssueKeys.add(issueKey);
  issues.push(
    createQualityIssue({
      code,
      message,
      statementId,
    }),
  );
}

function detectTopLevelAppShellIssues(source: string, issues: BuilderParseIssue[], seenIssueKeys: Set<string>) {
  const appShellStatements = collectTopLevelStatements(source).filter((statement) =>
    statement.rawValueSource.trimStart().startsWith('AppShell('),
  );

  for (const statement of appShellStatements) {
    if (statement.statementId === 'root') {
      continue;
    }

    pushUniqueIssue(
      issues,
      seenIssueKeys,
      'app-shell-not-root',
      'AppShell must be the single root statement. Keep exactly one `root = AppShell([...])` and never define AppShell anywhere else.',
      statement.statementId,
    );
  }

  if (appShellStatements.length > 1) {
    pushUniqueIssue(
      issues,
      seenIssueKeys,
      'multiple-app-shells',
      'Only one AppShell is allowed in the final source. Keep a single `root = AppShell([...])` statement.',
      'root',
    );
  }
}

function detectNestedChildContainerIssues(
  root: unknown,
  parentTypeName: 'Repeater' | 'Screen',
  nestedTypeName: 'Repeater' | 'Screen',
  code: 'repeater-inside-repeater' | 'screen-inside-screen',
  message: string,
  issues: BuilderParseIssue[],
  seenIssueKeys: Set<string>,
) {
  visitOpenUiValue(root, (node, context) => {
    if (!isComponentNode(node, parentTypeName)) {
      return;
    }

    const children = getComponentChildren(node);

    if (children == null) {
      return;
    }

    let hasNestedViolation = false;

    visitOpenUiValue(children, (nestedNode) => {
      if (!hasNestedViolation && isComponentNode(nestedNode, nestedTypeName)) {
        hasNestedViolation = true;
      }
    }, context.statementId);

    if (!hasNestedViolation) {
      return;
    }

    pushUniqueIssue(issues, seenIssueKeys, code, message, context.statementId ?? 'root');
  });
}

function detectNestedAppShellIssues(root: unknown, issues: BuilderParseIssue[], seenIssueKeys: Set<string>) {
  visitOpenUiValue(root, (node, context) => {
    if (node === root || !isComponentNode(node, 'AppShell')) {
      return;
    }

    pushUniqueIssue(
      issues,
      seenIssueKeys,
      'app-shell-not-root',
      'AppShell must be the single root statement. Keep exactly one `root = AppShell([...])` and never nest AppShell inside other components or expressions.',
      context.statementId ?? 'root',
    );
  });
}

export function detectStructuralInvariantIssues(source: string, result: ParseResult): BuilderParseIssue[] {
  if (result.meta.incomplete) {
    return [];
  }

  const issues: BuilderParseIssue[] = [];
  const seenIssueKeys = new Set<string>();

  detectTopLevelAppShellIssues(source, issues, seenIssueKeys);

  if (!result.root) {
    return issues;
  }

  detectNestedAppShellIssues(result.root, issues, seenIssueKeys);
  detectNestedChildContainerIssues(
    result.root,
    'Screen',
    'Screen',
    'screen-inside-screen',
    'Screen cannot contain another Screen at any depth. Keep Screens as top-level AppShell children and use Group for local layout inside a screen.',
    issues,
    seenIssueKeys,
  );
  detectNestedChildContainerIssues(
    result.root,
    'Repeater',
    'Repeater',
    'repeater-inside-repeater',
    'Repeater cannot contain another Repeater at any depth. Flatten the list or use Group inside the row template instead of nesting Repeaters.',
    issues,
    seenIssueKeys,
  );

  return issues;
}
