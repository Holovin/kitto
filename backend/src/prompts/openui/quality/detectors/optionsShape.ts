import { createOpenUiQualityIssue, escapeRegExp, isElementNode, parser, type OpenUiQualityIssue } from '../shared.js';

const TOP_LEVEL_ASSIGNMENT_LINE_PATTERN = /^(\$?[A-Za-z_][\w$]*)\s*=\s*(.*)$/;
const CHOICE_CONTROL_TYPE_NAMES = ['RadioGroup', 'Select'] as const;
const BARE_OPTIONS_MESSAGE = 'RadioGroup/Select options must be `{label, value}` objects, not bare strings or numbers.';
const PROBE_SOURCE_PREFIX = 'expr = ';
const PROBE_SOURCE_SUFFIX = `
root = AppShell([
  Screen("probe", "Probe", [
    Text(expr, "body", "start")
  ])
])`;

type ComponentCallMatch = {
  args: string[];
  text: string;
};

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
      currentStatementId = assignmentMatch[1] ?? null;
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

function findMatchingDelimiter(source: string, openIndex: number, openChar: string, closeChar: string) {
  let depth = 0;
  let activeQuote: '"' | "'" | null = null;
  let isEscaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
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

    if (character === openChar) {
      depth += 1;
      continue;
    }

    if (character === closeChar) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevelArgs(source: string) {
  const args: string[] = [];
  let activeQuote: '"' | "'" | null = null;
  let isEscaped = false;
  let curlyDepth = 0;
  let parenDepth = 0;
  let squareDepth = 0;
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

    if (character === '{') {
      curlyDepth += 1;
      continue;
    }

    if (character === '}') {
      curlyDepth -= 1;
      continue;
    }

    if (character === '(') {
      parenDepth += 1;
      continue;
    }

    if (character === ')') {
      parenDepth -= 1;
      continue;
    }

    if (character === '[') {
      squareDepth += 1;
      continue;
    }

    if (character === ']') {
      squareDepth -= 1;
      continue;
    }

    if (character === ',' && curlyDepth === 0 && parenDepth === 0 && squareDepth === 0) {
      args.push(source.slice(segmentStart, index).trim());
      segmentStart = index + 1;
    }
  }

  const trailingSegment = source.slice(segmentStart).trim();

  if (trailingSegment) {
    args.push(trailingSegment);
  }

  return args;
}

function findFunctionCalls(source: string, functionName: string) {
  const matches: ComponentCallMatch[] = [];
  const callPattern = new RegExp(`\\b${escapeRegExp(functionName)}\\s*\\(`, 'g');
  let match = callPattern.exec(source);

  while (match) {
    const matchText = match[0] ?? '';
    const openParenIndex = (match.index ?? 0) + matchText.lastIndexOf('(');
    const closeParenIndex = findMatchingDelimiter(source, openParenIndex, '(', ')');

    if (closeParenIndex >= 0) {
      const callText = source.slice(match.index ?? 0, closeParenIndex + 1);
      const argsSource = source.slice(openParenIndex + 1, closeParenIndex);
      matches.push({
        args: splitTopLevelArgs(argsSource),
        text: callText,
      });
    }

    match = callPattern.exec(source);
  }

  return matches;
}

function parseStringLiteralValue(value: string) {
  const trimmedValue = value.trim();

  if (
    trimmedValue.length >= 2 &&
    ((trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) || (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return null;
}

function parseExpressionValue(expressionSource: string) {
  const wrappedSource = `${PROBE_SOURCE_PREFIX}${expressionSource}${PROBE_SOURCE_SUFFIX}`;
  const result = parser.parse(wrappedSource);

  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root) {
    return null;
  }

  const screenNode = Array.isArray(result.root.props.children) ? result.root.props.children[0] : null;

  if (!isElementNode(screenNode)) {
    return null;
  }

  const textNode = Array.isArray(screenNode.props.children) ? screenNode.props.children[0] : null;

  return isElementNode(textNode) ? textNode.props.value : null;
}

function isBarePrimitiveChoiceOptionsArray(value: unknown): value is Array<number | string> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'number' || typeof entry === 'string')
  );
}

function collectionContainsBarePrimitiveOptions(value: unknown) {
  return (
    Array.isArray(value) &&
    value.some(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        'options' in entry &&
        isBarePrimitiveChoiceOptionsArray((entry as { options?: unknown }).options),
    )
  );
}

function extractIdentifier(value: string) {
  const trimmedValue = value.trim();
  return /^[A-Za-z_][\w$]*$/.test(trimmedValue) ? trimmedValue : null;
}

function extractOptionsMemberRoot(value: string) {
  const compactValue = value.replace(/\s+/g, '');
  const match = compactValue.match(/^([A-Za-z_][\w$]*)(?:\[[^\]]+\])?(?:\.[A-Za-z_][\w$]*)*\.options$/);
  return match?.[1] ?? null;
}

function resolveCollectionStatementId(
  collectionSource: string,
  statementSources: Map<string, string>,
  aliasBindings: Map<string, string>,
) {
  const directIdentifier = extractIdentifier(collectionSource);

  if (directIdentifier) {
    return aliasBindings.get(directIdentifier) ?? (statementSources.has(directIdentifier) ? directIdentifier : null);
  }

  return null;
}

function getParsedStatementValue(
  statementId: string,
  statementSources: Map<string, string>,
  valueCache: Map<string, unknown>,
) {
  if (valueCache.has(statementId)) {
    return valueCache.get(statementId);
  }

  const statementSource = statementSources.get(statementId);
  const parsedValue = statementSource ? parseExpressionValue(statementSource) : null;
  valueCache.set(statementId, parsedValue);
  return parsedValue;
}

function resolveOptionsShapeIssue(
  optionsSource: string,
  ownerStatementId: string,
  statementSources: Map<string, string>,
  aliasBindings: Map<string, string>,
  valueCache: Map<string, unknown>,
) {
  const trimmedSource = optionsSource.trim();

  if (!trimmedSource || trimmedSource === 'null') {
    return null;
  }

  if (trimmedSource.startsWith('[')) {
    return isBarePrimitiveChoiceOptionsArray(parseExpressionValue(trimmedSource))
      ? { message: BARE_OPTIONS_MESSAGE, statementId: ownerStatementId }
      : null;
  }

  const directIdentifier = extractIdentifier(trimmedSource);

  if (directIdentifier && statementSources.has(directIdentifier)) {
    return isBarePrimitiveChoiceOptionsArray(getParsedStatementValue(directIdentifier, statementSources, valueCache))
      ? { message: BARE_OPTIONS_MESSAGE, statementId: directIdentifier }
      : null;
  }

  const memberRoot = extractOptionsMemberRoot(trimmedSource);
  const declarationStatementId = memberRoot ? aliasBindings.get(memberRoot) ?? memberRoot : null;

  if (!declarationStatementId || !statementSources.has(declarationStatementId)) {
    return null;
  }

  return collectionContainsBarePrimitiveOptions(getParsedStatementValue(declarationStatementId, statementSources, valueCache))
    ? {
        message: `Collection \`${declarationStatementId}\` contains \`.options\` arrays with bare strings or numbers. RadioGroup/Select options must be \`{label, value}\` objects.`,
        statementId: declarationStatementId,
      }
    : null;
}

function detectOptionsShapeIssuesInFragment(
  sourceFragment: string,
  ownerStatementId: string,
  statementSources: Map<string, string>,
  aliasBindings: Map<string, string>,
  valueCache: Map<string, unknown>,
  seenIssueKeys: Set<string>,
  issues: OpenUiQualityIssue[],
) {
  for (const controlTypeName of CHOICE_CONTROL_TYPE_NAMES) {
    for (const call of findFunctionCalls(sourceFragment, controlTypeName)) {
      const optionsSource = call.args[3] ?? '';
      const resolvedIssue = resolveOptionsShapeIssue(optionsSource, ownerStatementId, statementSources, aliasBindings, valueCache);

      if (!resolvedIssue) {
        continue;
      }

      const issueKey = `${resolvedIssue.statementId ?? ownerStatementId}:${optionsSource.trim()}`;

      if (seenIssueKeys.has(issueKey)) {
        continue;
      }

      seenIssueKeys.add(issueKey);
      issues.push(
        createOpenUiQualityIssue('blocking-quality', {
          code: 'quality-options-shape',
          message: resolvedIssue.message,
          statementId: resolvedIssue.statementId,
        }),
      );
    }
  }

  for (const eachCall of findFunctionCalls(sourceFragment, 'Each')) {
    const collectionSource = eachCall.args[0] ?? '';
    const rowSource = eachCall.args[2] ?? '';
    const itemAlias = parseStringLiteralValue(eachCall.args[1] ?? '') ?? 'item';
    const collectionStatementId = resolveCollectionStatementId(collectionSource, statementSources, aliasBindings);
    const nextAliasBindings = new Map(aliasBindings);

    if (collectionStatementId) {
      nextAliasBindings.set(itemAlias, collectionStatementId);
    }

    detectOptionsShapeIssuesInFragment(
      rowSource,
      ownerStatementId,
      statementSources,
      nextAliasBindings,
      valueCache,
      seenIssueKeys,
      issues,
    );
  }
}

export function detectChoiceOptionsShapeIssues(source: string): OpenUiQualityIssue[] {
  const statements = collectTopLevelStatements(source);
  const statementSources = new Map(statements.map((statement) => [statement.statementId, statement.rawValueSource]));
  const valueCache = new Map<string, unknown>();
  const seenIssueKeys = new Set<string>();
  const issues: OpenUiQualityIssue[] = [];

  for (const statement of statements) {
    detectOptionsShapeIssuesInFragment(
      statement.rawValueSource,
      statement.statementId,
      statementSources,
      new Map<string, string>(),
      valueCache,
      seenIssueKeys,
      issues,
    );
  }

  return issues;
}
