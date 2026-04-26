import { escapeRegExp } from './openuiAst.js';

export interface OpenUiFunctionCallMatch {
  args: string[];
  text: string;
}

export function findMatchingDelimiter(source: string, openIndex: number, openChar: string, closeChar: string) {
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

export function splitTopLevelArgs(source: string) {
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

export function findFunctionCalls(source: string, functionName: string): OpenUiFunctionCallMatch[] {
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

export function parseStringLiteralValue(value: string) {
  const trimmedValue = value.trim();

  if (
    trimmedValue.length >= 2 &&
    ((trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) || (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return null;
}
