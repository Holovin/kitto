import type { ParseResult } from '@openuidev/react-lang';
import {
  createOpenUiQualityIssue,
  escapeRegExp,
  isAstNode,
  maskStringLiterals,
  type OpenUiQualityIssue,
} from '@features/builder/openui/runtime/validation/shared';

const RESERVED_STATE_REF_NAMES = new Set(['$lastChoice']);
const TOP_LEVEL_ASSIGNMENT_LINE_PATTERN = /^(\$?[A-Za-z_][\w$]*)\s*=\s*(.*)$/;
const SIMPLE_LITERAL_PATTERN = `"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|true|false|null|-?\\d+(?:\\.\\d+)?`;

type TopLevelStatement = {
  maskedValueSource: string;
  rawValueSource: string;
  statementId: string;
};

function collectTopLevelStatements(source: string): TopLevelStatement[] {
  const rawLines = source.split('\n');
  const maskedLines = maskStringLiterals(source).split('\n');
  const statements: TopLevelStatement[] = [];
  let currentStatementId: string | null = null;
  let currentMaskedLines: string[] = [];
  let currentRawLines: string[] = [];

  function flushCurrentStatement() {
    if (!currentStatementId) {
      return;
    }

    statements.push({
      statementId: currentStatementId,
      maskedValueSource: currentMaskedLines.join('\n'),
      rawValueSource: currentRawLines.join('\n'),
    });
  }

  for (let index = 0; index < maskedLines.length; index += 1) {
    const maskedLine = maskedLines[index] ?? '';
    const rawLine = rawLines[index] ?? '';
    const maskedAssignmentMatch = maskedLine.match(TOP_LEVEL_ASSIGNMENT_LINE_PATTERN);

    if (maskedAssignmentMatch) {
      flushCurrentStatement();
      currentStatementId = maskedAssignmentMatch[1];
      currentMaskedLines = [maskedAssignmentMatch[2] ?? ''];
      currentRawLines = [rawLine.replace(TOP_LEVEL_ASSIGNMENT_LINE_PATTERN, '$2')];
      continue;
    }

    if (!currentStatementId) {
      continue;
    }

    currentMaskedLines.push(maskedLine);
    currentRawLines.push(rawLine);
  }

  flushCurrentStatement();
  return statements;
}

function inferInitializerExample(refName: string, statementValueSource: string) {
  const escapedRefName = escapeRegExp(refName);
  const equalityPatterns = [
    new RegExp(`${escapedRefName}\\s*(?:===|==|!==|!=)\\s*(${SIMPLE_LITERAL_PATTERN})`),
    new RegExp(`(${SIMPLE_LITERAL_PATTERN})\\s*(?:===|==|!==|!=)\\s*${escapedRefName}`),
  ];

  for (const pattern of equalityPatterns) {
    const match = statementValueSource.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  const setPattern = new RegExp(`@Set\\(\\s*${escapedRefName}\\s*,\\s*(${SIMPLE_LITERAL_PATTERN})\\s*\\)`);
  const setMatch = statementValueSource.match(setPattern);

  return setMatch?.[1] ?? null;
}

export function detectUndefinedStateReferenceIssues(source: string, result: ParseResult): OpenUiQualityIssue[] {
  if (result.meta.incomplete) {
    return [];
  }

  const issues: OpenUiQualityIssue[] = [];
  const topLevelStatements = collectTopLevelStatements(source);
  const declaredStateRefs = new Set(
    topLevelStatements
      .filter((statement) => statement.statementId.startsWith('$'))
      .filter((statement) => statement.statementId in (result.stateDeclarations ?? {}))
      .filter((statement) => !isAstNode(result.stateDeclarations[statement.statementId]))
      .map((statement) => statement.statementId),
  );
  const seenStateRefs = new Set<string>();
  const stateRefPattern = /(?<![\w$])(\$[A-Za-z_][\w$]*)(?![\w$])/g;

  for (const statement of topLevelStatements) {
    stateRefPattern.lastIndex = 0;
    let refMatch = stateRefPattern.exec(statement.maskedValueSource);

    while (refMatch) {
      const refName = refMatch[1];

      if (!declaredStateRefs.has(refName) && !RESERVED_STATE_REF_NAMES.has(refName) && !seenStateRefs.has(refName)) {
        seenStateRefs.add(refName);

        const exampleInitializer = inferInitializerExample(refName, statement.rawValueSource);
        const exampleMessage = exampleInitializer ? ` For example, add \`${refName} = ${exampleInitializer}\`.` : '';

        issues.push(
          createOpenUiQualityIssue('blocking-quality', {
            code: 'undefined-state-reference',
            message: `State reference \`${refName}\` is missing a top-level declaration with a literal initial value.${exampleMessage}`,
            statementId: statement.statementId,
          }),
        );
      }

      refMatch = stateRefPattern.exec(statement.maskedValueSource);
    }
  }

  return issues;
}
