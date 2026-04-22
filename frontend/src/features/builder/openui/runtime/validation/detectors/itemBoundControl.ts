import {
  createOpenUiQualityIssue,
  escapeRegExp,
  maskStringLiterals,
  type OpenUiQualityIssue,
} from '@features/builder/openui/runtime/validation/shared';

const ITEM_SCOPED_CONTROL_TYPE_NAMES = new Set(['Checkbox', 'Input', 'RadioGroup', 'Select', 'TextArea']);

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
  const matches: Array<{ args: string[]; text: string }> = [];
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

function getItemScopedControlArgIndexes(typeName: string) {
  if (typeName === 'Checkbox') {
    return {
      action: 5,
      binding: 2,
      name: 0,
    };
  }

  if (typeName === 'Input' || typeName === 'TextArea') {
    return {
      action: null,
      binding: 2,
      name: 0,
    };
  }

  if (typeName === 'RadioGroup' || typeName === 'Select') {
    return {
      action: 6,
      binding: 2,
      name: 0,
    };
  }

  return null;
}

function sourceReferencesItemField(expressionSource: string, itemAlias: string) {
  if (!expressionSource.trim()) {
    return false;
  }

  return new RegExp(`(?<![\\w$])${escapeRegExp(itemAlias)}\\.[A-Za-z_][\\w-]*\\b`).test(maskStringLiterals(expressionSource));
}

export function detectItemBoundControlsWithoutAction(source: string): OpenUiQualityIssue[] {
  const issues: OpenUiQualityIssue[] = [];
  const seenIssueKeys = new Set<string>();

  for (const eachCall of findFunctionCalls(source, 'Each')) {
    const collectionLabel = eachCall.args[0]?.trim() || 'the repeated collection';
    const itemAlias = parseStringLiteralValue(eachCall.args[1] ?? '') ?? 'item';
    const rowSource = eachCall.args[2] ?? '';

    for (const controlTypeName of ITEM_SCOPED_CONTROL_TYPE_NAMES) {
      const argIndexes = getItemScopedControlArgIndexes(controlTypeName);

      if (!argIndexes) {
        continue;
      }

      for (const controlCall of findFunctionCalls(rowSource, controlTypeName)) {
        const nameSource = controlCall.args[argIndexes.name] ?? '';
        const bindingSource = controlCall.args[argIndexes.binding] ?? '';
        const actionSource = argIndexes.action == null ? '' : (controlCall.args[argIndexes.action] ?? '');
        const hasAction = actionSource.trim() !== '' && actionSource.trim() !== 'null';

        if (
          hasAction ||
          (!sourceReferencesItemField(nameSource, itemAlias) && !sourceReferencesItemField(bindingSource, itemAlias))
        ) {
          continue;
        }

        const issueKey = `${controlTypeName}:${collectionLabel}:${controlCall.text}`;

        if (seenIssueKeys.has(issueKey)) {
          continue;
        }

        seenIssueKeys.add(issueKey);
        issues.push(
          createOpenUiQualityIssue('blocking-quality', {
            code: 'item-bound-control-without-action',
            message: `Item-scoped control without \`action\` will not persist changes back to \`${collectionLabel}\`. Use action-mode with \`toggle_item_field\` / \`update_item_field\`.`,
          }),
        );
      }
    }
  }

  return issues;
}
