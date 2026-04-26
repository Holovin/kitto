interface PartialJsonStringValue {
  complete: boolean;
  value: string;
}

interface PartialOpenUiEnvelope {
  source?: PartialJsonStringValue;
  summary?: PartialJsonStringValue;
}

function isHexDigit(value: string) {
  return /^[0-9a-fA-F]$/.test(value);
}

function readPartialJsonString(input: string, startIndex: number): PartialJsonStringValue & { nextIndex: number } {
  let value = '';
  let index = startIndex;

  while (index < input.length) {
    const currentCharacter = input[index];

    if (currentCharacter === '"') {
      return {
        complete: true,
        nextIndex: index + 1,
        value,
      };
    }

    if (currentCharacter !== '\\') {
      value += currentCharacter;
      index += 1;
      continue;
    }

    const escapedCharacter = input[index + 1];

    if (escapedCharacter === undefined) {
      return {
        complete: false,
        nextIndex: input.length,
        value,
      };
    }

    if (escapedCharacter === 'u') {
      const unicodeDigits = input.slice(index + 2, index + 6);

      if (unicodeDigits.length < 4 || [...unicodeDigits].some((digit) => !isHexDigit(digit))) {
        return {
          complete: false,
          nextIndex: input.length,
          value,
        };
      }

      value += String.fromCharCode(Number.parseInt(unicodeDigits, 16));
      index += 6;
      continue;
    }

    switch (escapedCharacter) {
      case '"':
      case '\\':
      case '/':
        value += escapedCharacter;
        break;
      case 'b':
        value += '\b';
        break;
      case 'f':
        value += '\f';
        break;
      case 'n':
        value += '\n';
        break;
      case 'r':
        value += '\r';
        break;
      case 't':
        value += '\t';
        break;
      default:
        value += escapedCharacter;
        break;
    }

    index += 2;
  }

  return {
    complete: false,
    nextIndex: input.length,
    value,
  };
}

export function parsePartialOpenUiEnvelope(input: string): PartialOpenUiEnvelope {
  const parsedEnvelope: PartialOpenUiEnvelope = {};
  let index = 0;
  let depth = 0;
  let currentKey: string | null = null;
  let expectingKey = false;
  let expectingValue = false;

  while (index < input.length) {
    const currentCharacter = input[index];

    if (/\s/.test(currentCharacter)) {
      index += 1;
      continue;
    }

    if (currentCharacter === '{') {
      depth += 1;
      if (depth === 1) {
        currentKey = null;
        expectingKey = true;
        expectingValue = false;
      }
      index += 1;
      continue;
    }

    if (currentCharacter === '}') {
      if (depth === 1) {
        currentKey = null;
        expectingKey = false;
        expectingValue = false;
      }

      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }

    if (currentCharacter === '[') {
      depth += 1;
      index += 1;
      continue;
    }

    if (currentCharacter === ']') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }

    if (currentCharacter === ',') {
      if (depth === 1) {
        currentKey = null;
        expectingKey = true;
        expectingValue = false;
      }
      index += 1;
      continue;
    }

    if (currentCharacter === ':') {
      if (depth === 1 && currentKey !== null) {
        expectingValue = true;
      }
      index += 1;
      continue;
    }

    if (currentCharacter !== '"') {
      index += 1;
      continue;
    }

    const parsedString = readPartialJsonString(input, index + 1);

    if (depth === 1 && expectingKey) {
      currentKey = parsedString.value;
      expectingKey = false;
      index = parsedString.nextIndex;
      continue;
    }

    if (depth === 1 && expectingValue && (currentKey === 'source' || currentKey === 'summary')) {
      parsedEnvelope[currentKey] = {
        complete: parsedString.complete,
        value: parsedString.value,
      };
      if (parsedString.complete) {
        expectingValue = false;
      }
      index = parsedString.nextIndex;
      continue;
    }

    index = parsedString.nextIndex;
  }

  return parsedEnvelope;
}

export function isMalformedStructuredChunk(chunk: string) {
  const trimmedChunk = chunk.trim();

  if (!trimmedChunk.startsWith('{') || !trimmedChunk.endsWith('}')) {
    return false;
  }

  if (!trimmedChunk.includes('"source"') && !trimmedChunk.includes('"summary"')) {
    return false;
  }

  const parsedChunk = parsePartialOpenUiEnvelope(trimmedChunk);
  return parsedChunk.source === undefined && parsedChunk.summary === undefined;
}
