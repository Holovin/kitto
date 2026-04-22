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
      key: entryMatch[1] ?? '',
      value: (entryMatch[2] ?? '').trim(),
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

function collectAutoFixReplacements(source: string) {
  const replacements: Array<{ from: string; to: string }> = [];

  for (const call of findFunctionCalls(source, 'AppShell')) {
    const firstArg = call.args[0];
    const secondArg = call.args[1];

    if (call.args.length === 0) {
      replacements.push({
        from: call.text,
        to: 'AppShell([])',
      });
      continue;
    }

    if (call.args.length === 1 && typeof firstArg === 'string' && isObjectLiteral(firstArg)) {
      replacements.push({
        from: call.text,
        to: formatFunctionCall('AppShell', ['[]', firstArg]),
      });
      continue;
    }

    if (
      call.args.length === 2 &&
      typeof firstArg === 'string' &&
      typeof secondArg === 'string' &&
      isObjectLiteral(firstArg) &&
      isArrayLiteral(secondArg)
    ) {
      replacements.push({
        from: call.text,
        to: formatFunctionCall('AppShell', [secondArg, firstArg]),
      });
    }
  }

  for (const call of findFunctionCalls(source, 'Screen')) {
    if (call.args.length === 2) {
      replacements.push({
        from: call.text,
        to: formatFunctionCall('Screen', [...call.args, '[]']),
      });
    }
  }

  for (const call of findFunctionCalls(source, 'Group')) {
    if (call.args.length < 2) {
      continue;
    }

    const secondArgValue = call.args[1]?.trim() ?? '';
    const thirdArgValue = call.args[2]?.trim() ?? '';
    let nextArgs: string[] | null = null;
    const firstArg = call.args[0];
    const secondArg = call.args[1];
    const thirdArg = call.args[2];

    if (isArrayLiteral(secondArgValue)) {
      const thirdLiteral = parseStringLiteralValue(thirdArgValue);

      if (typeof firstArg !== 'string' || typeof secondArg !== 'string') {
        continue;
      }

      if (!thirdArgValue) {
        nextArgs = [firstArg, '"vertical"', secondArg];
      } else if ((thirdLiteral === 'vertical' || thirdLiteral === 'horizontal') && typeof thirdArg === 'string') {
        nextArgs = [firstArg, thirdArg, secondArg, ...call.args.slice(3)];
      } else if ((thirdLiteral === 'block' || thirdLiteral === 'inline') && typeof thirdArg === 'string') {
        nextArgs = [firstArg, '"vertical"', secondArg, thirdArg, ...call.args.slice(3)];
      }
    } else {
      const secondLiteral = parseStringLiteralValue(secondArgValue);

      if (
        typeof firstArg === 'string' &&
        typeof secondArg === 'string' &&
        typeof thirdArg === 'string' &&
        (secondLiteral === 'block' || secondLiteral === 'inline') &&
        isArrayLiteral(thirdArgValue)
      ) {
        nextArgs = [firstArg, '"vertical"', thirdArg, secondArg, ...call.args.slice(3)];
      }
    }

    if (!nextArgs) {
      continue;
    }

    replacements.push({
      from: call.text,
      to: formatFunctionCall('Group', nextArgs),
    });
  }

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
        replacements.push({
          from: call.text,
          to: formatFunctionCall(componentName, nextArgs),
        });
      }
    }
  }

  return replacements;
}

export function applyOpenUiAutoFixSuggestions(source: string) {
  const replacements = collectAutoFixReplacements(source).sort((left, right) => right.from.length - left.from.length);
  let nextSource = source;

  for (const replacement of replacements) {
    if (!replacement.from || replacement.from === replacement.to || !nextSource.includes(replacement.from)) {
      continue;
    }

    nextSource = nextSource.replace(replacement.from, replacement.to);
  }

  return nextSource;
}
