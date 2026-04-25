export type SharedOpenUiQualityIssueSeverity = 'blocking-quality' | 'fatal-quality' | 'soft-warning';

export interface SharedOpenUiQualityIssue {
  code: string;
  context?: SharedOpenUiQualityIssueContext;
  message: string;
  severity: SharedOpenUiQualityIssueSeverity;
  source: 'quality';
  statementId?: string;
}

export interface SharedOptionsShapeIssueContext {
  groupId: string;
  invalidValues: Array<number | string>;
}

export type SharedOpenUiQualityIssueContext = SharedOptionsShapeIssueContext;

export interface DetectChoiceOptionsShapeIssuesOptions {
  parseExpressionValue: (expressionSource: string) => unknown;
}

const TOP_LEVEL_ASSIGNMENT_LINE_PATTERN = /^(\$?[A-Za-z_][\w$]*)\s*=\s*(.*)$/;
const CHOICE_CONTROL_TYPE_NAMES = ['RadioGroup', 'Select'] as const;
const BARE_OPTIONS_MESSAGE = 'RadioGroup/Select options must be `{label, value}` objects, not bare strings or numbers.';
const MAX_CONTEXT_INVALID_VALUES = 20;

type ComponentCallMatch = {
  args: string[];
};

type TopLevelStatement = {
  rawValueSource: string;
  statementId: string;
};

function createSharedOpenUiQualityIssue(
  severity: SharedOpenUiQualityIssueSeverity,
  issue: Omit<SharedOpenUiQualityIssue, 'severity' | 'source'>,
): SharedOpenUiQualityIssue {
  return {
    ...issue,
    severity,
    source: 'quality',
  };
}

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
      const nextStatementId = assignmentMatch[1];

      if (!nextStatementId) {
        continue;
      }

      flushCurrentStatement();
      currentStatementId = nextStatementId;
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      const argsSource = source.slice(openParenIndex + 1, closeParenIndex);
      matches.push({
        args: splitTopLevelArgs(argsSource),
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

function isBarePrimitiveChoiceOptionsArray(value: unknown): value is Array<number | string> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'number' || typeof entry === 'string')
  );
}

function capInvalidValues(invalidValues: Array<number | string>) {
  return invalidValues.slice(0, MAX_CONTEXT_INVALID_VALUES);
}

function getBarePrimitiveOptionValues(value: unknown) {
  return isBarePrimitiveChoiceOptionsArray(value) ? capInvalidValues(value) : null;
}

function getCollectionBarePrimitiveOptionValues(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const invalidValues: Array<number | string> = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || !('options' in entry)) {
      continue;
    }

    const optionValues = getBarePrimitiveOptionValues((entry as { options?: unknown }).options);

    if (optionValues) {
      invalidValues.push(...optionValues);
    }
  }

  return invalidValues.length > 0 ? capInvalidValues(invalidValues) : null;
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
  parseExpressionValue: DetectChoiceOptionsShapeIssuesOptions['parseExpressionValue'],
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
  parseExpressionValue: DetectChoiceOptionsShapeIssuesOptions['parseExpressionValue'],
) {
  const trimmedSource = optionsSource.trim();

  if (!trimmedSource || trimmedSource === 'null') {
    return null;
  }

  if (trimmedSource.startsWith('[')) {
    const invalidValues = getBarePrimitiveOptionValues(parseExpressionValue(trimmedSource));

    return invalidValues
      ? {
          context: {
            groupId: ownerStatementId,
            invalidValues,
          },
          message: BARE_OPTIONS_MESSAGE,
          statementId: ownerStatementId,
        }
      : null;
  }

  const directIdentifier = extractIdentifier(trimmedSource);

  if (directIdentifier && statementSources.has(directIdentifier)) {
    const invalidValues = getBarePrimitiveOptionValues(
      getParsedStatementValue(directIdentifier, statementSources, valueCache, parseExpressionValue),
    );

    return invalidValues
      ? {
          context: {
            groupId: directIdentifier,
            invalidValues,
          },
          message: BARE_OPTIONS_MESSAGE,
          statementId: directIdentifier,
        }
      : null;
  }

  const memberRoot = extractOptionsMemberRoot(trimmedSource);
  const declarationStatementId = memberRoot ? aliasBindings.get(memberRoot) ?? memberRoot : null;

  if (!declarationStatementId || !statementSources.has(declarationStatementId)) {
    return null;
  }

  const invalidValues = getCollectionBarePrimitiveOptionValues(
    getParsedStatementValue(declarationStatementId, statementSources, valueCache, parseExpressionValue),
  )

  return invalidValues
    ? {
        context: {
          groupId: declarationStatementId,
          invalidValues,
        },
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
  issues: SharedOpenUiQualityIssue[],
  parseExpressionValue: DetectChoiceOptionsShapeIssuesOptions['parseExpressionValue'],
) {
  for (const controlTypeName of CHOICE_CONTROL_TYPE_NAMES) {
    for (const call of findFunctionCalls(sourceFragment, controlTypeName)) {
      const optionsSource = call.args[3] ?? '';
      const resolvedIssue = resolveOptionsShapeIssue(
        optionsSource,
        ownerStatementId,
        statementSources,
        aliasBindings,
        valueCache,
        parseExpressionValue,
      );

      if (!resolvedIssue) {
        continue;
      }

      const issueKey = `${resolvedIssue.statementId ?? ownerStatementId}:${optionsSource.trim()}`;

      if (seenIssueKeys.has(issueKey)) {
        continue;
      }

      seenIssueKeys.add(issueKey);
      issues.push(
        createSharedOpenUiQualityIssue('blocking-quality', {
          code: 'quality-options-shape',
          context: resolvedIssue.context,
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
      parseExpressionValue,
    );
  }
}

export function detectChoiceOptionsShapeIssues(
  source: string,
  { parseExpressionValue }: DetectChoiceOptionsShapeIssuesOptions,
): SharedOpenUiQualityIssue[] {
  const statements = collectTopLevelStatements(source);
  const statementSources = new Map(statements.map((statement) => [statement.statementId, statement.rawValueSource]));
  const valueCache = new Map<string, unknown>();
  const seenIssueKeys = new Set<string>();
  const issues: SharedOpenUiQualityIssue[] = [];

  for (const statement of statements) {
    detectOptionsShapeIssuesInFragment(
      statement.rawValueSource,
      statement.statementId,
      statementSources,
      new Map<string, string>(),
      valueCache,
      seenIssueKeys,
      issues,
      parseExpressionValue,
    );
  }

  return issues;
}
