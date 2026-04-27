import type { ParseResult } from '@openuidev/react-lang';
import {
  createOpenUiQualityIssue,
  escapeRegExp,
  type OpenUiProgramIndex,
  type BuilderQualityIssue,
} from '@pages/Chat/builder/openui/runtime/validation/shared';

const RESERVED_STATE_REF_NAMES = new Set(['$lastChoice']);
const SIMPLE_LITERAL_PATTERN = `"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|true|false|null|-?\\d+(?:\\.\\d+)?`;

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

export function detectUndefinedStateReferenceIssues(result: ParseResult, programIndex: OpenUiProgramIndex): BuilderQualityIssue[] {
  if (result.meta.incomplete) {
    return [];
  }

  const issues: BuilderQualityIssue[] = [];
  const topLevelStatements = programIndex.topLevelStatements;
  const declaredStateRefs = programIndex.declaredStateRefs;
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
        const issueContext = exampleInitializer ? { exampleInitializer, refName } : { refName };

        issues.push(
          createOpenUiQualityIssue('blocking-quality', {
            code: 'undefined-state-reference',
            context: issueContext,
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
