import type { BuilderParseIssue, BuilderParseIssueSuggestion } from '@features/builder/types';
import { createParserIssue, escapeRegExp, type OpenUiFunctionCallMatch } from './shared';

function createReplaceTextSuggestion(from: string, to: string): BuilderParseIssueSuggestion | undefined {
  if (!from || from === to) {
    return undefined;
  }

  return {
    kind: 'replace-text',
    from,
    to,
  };
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

function findFunctionCalls(source: string, functionName: string): OpenUiFunctionCallMatch[] {
  const matches: OpenUiFunctionCallMatch[] = [];
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

function formatFunctionCall(functionName: string, args: string[]) {
  return `${functionName}(${args.join(', ')})`;
}

function isArrayLiteral(value: string) {
  const trimmedValue = value.trim();
  return trimmedValue.startsWith('[') && trimmedValue.endsWith(']');
}

function isObjectLiteral(value: string) {
  const trimmedValue = value.trim();
  return trimmedValue.startsWith('{') && trimmedValue.endsWith('}');
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

function parseAppearanceEntries(value: string) {
  if (!isObjectLiteral(value)) {
    return null;
  }

  const objectBody = value.trim().slice(1, -1).trim();

  if (!objectBody) {
    return [];
  }

  const entries = splitTopLevelArgs(objectBody).map((entrySource, index) => {
    const entryMatch = entrySource.match(/^([A-Za-z_][\w-]*)\s*:\s*([\s\S]+)$/);

    if (!entryMatch) {
      return null;
    }

    return {
      index,
      key: entryMatch[1],
      value: entryMatch[2].trim(),
    };
  });

  return entries.every((entry) => entry != null) ? entries : null;
}

function normalizeAppearanceObject(componentName: string, rawAppearance: string) {
  const entries = parseAppearanceEntries(rawAppearance);

  if (entries == null) {
    return null;
  }

  let hasChanges = false;
  const bestEntryByKey = new Map<
    string,
    {
      index: number;
      key: string;
      priority: number;
      value: string;
    }
  >();

  for (const entry of entries) {
    let nextKey = entry.key;
    let keepEntry = true;
    let priority = 2;

    if (componentName === 'Text') {
      if (entry.key === 'mainColor' || entry.key === 'textColor' || entry.key === 'color') {
        nextKey = 'contrastColor';
        priority = 1;
      } else if (entry.key === 'bgColor' || entry.key === 'background' || entry.key === 'backgroundColor') {
        keepEntry = false;
      } else if (entry.key !== 'contrastColor') {
        keepEntry = false;
      }
    } else {
      if (entry.key === 'textColor' || entry.key === 'color') {
        nextKey = 'contrastColor';
        priority = 1;
      } else if (entry.key === 'bgColor' || entry.key === 'background' || entry.key === 'backgroundColor') {
        nextKey = 'mainColor';
        priority = 1;
      } else if (entry.key !== 'mainColor' && entry.key !== 'contrastColor') {
        keepEntry = false;
      }
    }

    if (nextKey !== entry.key || !keepEntry) {
      hasChanges = true;
    }

    if (!keepEntry) {
      continue;
    }

    const currentBestEntry = bestEntryByKey.get(nextKey);

    if (
      !currentBestEntry ||
      priority > currentBestEntry.priority ||
      (priority === currentBestEntry.priority && entry.index > currentBestEntry.index)
    ) {
      bestEntryByKey.set(nextKey, {
        index: entry.index,
        key: nextKey,
        priority,
        value: entry.value,
      });
    }
  }

  if (!hasChanges) {
    return null;
  }

  const normalizedEntries = [...bestEntryByKey.values()]
    .sort((left, right) => left.index - right.index)
    .map((entry) => `${entry.key}: ${entry.value}`);

  return normalizedEntries.length > 0 ? `{ ${normalizedEntries.join(', ')} }` : '{}';
}

function collectArgumentAutoFixIssues(source: string): BuilderParseIssue[] {
  const issues: BuilderParseIssue[] = [];

  for (const call of findFunctionCalls(source, 'AppShell')) {
    if (call.args.length === 0) {
      const suggestion = createReplaceTextSuggestion(call.text, 'AppShell([])');

      if (suggestion) {
        issues.push(
          createParserIssue({
            code: 'invalid-args',
            message: 'AppShell is missing the required children array. Use AppShell(children, appearance?).',
            statementId: 'root',
            suggestion,
          }),
        );
      }

      continue;
    }

    if (call.args.length === 1 && isObjectLiteral(call.args[0])) {
      const suggestion = createReplaceTextSuggestion(call.text, formatFunctionCall('AppShell', ['[]', call.args[0]]));

      if (suggestion) {
        issues.push(
          createParserIssue({
            code: 'invalid-args',
            message: 'AppShell is missing the required children array. Use AppShell(children, appearance?).',
            statementId: 'root',
            suggestion,
          }),
        );
      }

      continue;
    }

    if (call.args.length === 2 && isObjectLiteral(call.args[0]) && isArrayLiteral(call.args[1])) {
      const suggestion = createReplaceTextSuggestion(call.text, formatFunctionCall('AppShell', [call.args[1], call.args[0]]));

      if (suggestion) {
        issues.push(
          createParserIssue({
            code: 'invalid-args',
            message: 'AppShell arguments are out of order. Use AppShell(children, appearance?).',
            statementId: 'root',
            suggestion,
          }),
        );
      }
    }
  }

  for (const call of findFunctionCalls(source, 'Screen')) {
    if (call.args.length === 2) {
      const suggestion = createReplaceTextSuggestion(call.text, formatFunctionCall('Screen', [...call.args, '[]']));

      if (suggestion) {
        issues.push(
          createParserIssue({
            code: 'invalid-args',
            message: 'Screen is missing the required children array. Use Screen(id, title, children, isActive?, appearance?).',
            suggestion,
          }),
        );
      }
    }
  }

  for (const call of findFunctionCalls(source, 'Group')) {
    if (call.args.length < 2) {
      continue;
    }

    const secondArgValue = call.args[1]?.trim() ?? '';
    const thirdArgValue = call.args[2]?.trim() ?? '';
    let nextArgs: string[] | null = null;
    let message = '';

    if (isArrayLiteral(secondArgValue)) {
      const thirdLiteral = parseStringLiteralValue(thirdArgValue);

      if (!thirdArgValue) {
        nextArgs = [call.args[0], '"vertical"', call.args[1]];
        message = 'Group is missing the required direction argument before children. Use Group(title, direction, children, variant?, appearance?).';
      } else if (thirdLiteral === 'vertical' || thirdLiteral === 'horizontal') {
        nextArgs = [call.args[0], call.args[2], call.args[1], ...call.args.slice(3)];
        message = 'Group arguments are out of order. Use Group(title, direction, children, variant?, appearance?).';
      } else if (thirdLiteral === 'block' || thirdLiteral === 'inline') {
        nextArgs = [call.args[0], '"vertical"', call.args[1], call.args[2], ...call.args.slice(3)];
        message =
          'Group children were passed before direction. Use Group(title, direction, children, variant?, appearance?) and keep "block" or "inline" in the optional fourth argument.';
      }
    } else {
      const secondLiteral = parseStringLiteralValue(secondArgValue);

      if ((secondLiteral === 'block' || secondLiteral === 'inline') && isArrayLiteral(thirdArgValue)) {
        nextArgs = [call.args[0], '"vertical"', call.args[2], call.args[1], ...call.args.slice(3)];
        message = 'Group variant was passed where direction belongs. Use Group(title, direction, children, variant?, appearance?).';
      }
    }

    if (!nextArgs) {
      continue;
    }

    const suggestion = createReplaceTextSuggestion(call.text, formatFunctionCall('Group', nextArgs));

    if (suggestion) {
      issues.push(
        createParserIssue({
          code: 'invalid-args',
          message,
          suggestion,
        }),
      );
    }
  }

  return issues;
}

function collectAppearanceAutoFixIssues(source: string): BuilderParseIssue[] {
  const issues: BuilderParseIssue[] = [];
  const componentNames = ['AppShell', 'Button', 'Checkbox', 'Group', 'Input', 'Link', 'RadioGroup', 'Repeater', 'Screen', 'Select', 'Text', 'TextArea'];

  for (const componentName of componentNames) {
    for (const call of findFunctionCalls(source, componentName)) {
      for (const [index, arg] of call.args.entries()) {
        if (!isObjectLiteral(arg)) {
          continue;
        }

        const normalizedAppearanceObject = normalizeAppearanceObject(componentName, arg);

        if (!normalizedAppearanceObject) {
          continue;
        }

        const nextArgs = [...call.args];
        nextArgs[index] = normalizedAppearanceObject;
        const suggestion = createReplaceTextSuggestion(call.text, formatFunctionCall(componentName, nextArgs));

        if (!suggestion) {
          continue;
        }

        issues.push(
          createParserIssue({
            code: 'invalid-prop',
            message:
              componentName === 'Text'
                ? 'Text.appearance supports only contrastColor. Replace legacy or unsupported appearance keys locally before commit.'
                : `${componentName}.appearance should use only mainColor and contrastColor keys.`,
            suggestion,
          }),
        );
      }
    }
  }

  return issues;
}

export function appendAutoFixSuggestionIssues(source: string, issues: BuilderParseIssue[]) {
  return [...issues, ...collectArgumentAutoFixIssues(source), ...collectAppearanceAutoFixIssues(source)];
}

export function applyOpenUiIssueSuggestions(source: string, issues: BuilderParseIssue[]) {
  const suggestions = issues
    .flatMap((issue) => (issue.suggestion ? [{ issue, suggestion: issue.suggestion }] : []))
    .filter(({ suggestion }) => suggestion.kind === 'replace-text' && suggestion.from && suggestion.from !== suggestion.to)
    .sort((left, right) => right.suggestion.from.length - left.suggestion.from.length);
  let nextSource = source;
  const appliedIssues: BuilderParseIssue[] = [];

  for (const { issue, suggestion } of suggestions) {
    if (!nextSource.includes(suggestion.from)) {
      continue;
    }

    nextSource = nextSource.replace(suggestion.from, suggestion.to);
    appliedIssues.push(issue);
  }

  return {
    appliedIssues,
    source: nextSource,
  };
}
