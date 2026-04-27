interface PartialJsonStringValue {
  complete: boolean;
  value: string;
}

interface PartialOpenUiEnvelope {
  source?: PartialJsonStringValue;
  summary?: PartialJsonStringValue;
}

type PartialOpenUiEnvelopeKey = keyof PartialOpenUiEnvelope;
type JsonStringTarget = PartialOpenUiEnvelopeKey | 'key' | 'skip';

const trackedStructuredChunkKeyLiterals = new Set(['"source"', '"summary"']);

interface ActiveJsonString {
  invalidUnicodeEscape: boolean;
  pendingEscape: boolean;
  target: JsonStringTarget;
  unicodeDigits: string;
  unicodeRemaining: number;
  value: string;
}

function isHexDigit(value: string) {
  return /^[0-9a-fA-F]$/.test(value);
}

function isJsonWhitespace(value: string) {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t';
}

function skipJsonWhitespace(input: string, startIndex: number) {
  let index = startIndex;

  while (index < input.length && isJsonWhitespace(input[index])) {
    index += 1;
  }

  return index;
}

function findJsonStringEnd(input: string, startIndex: number) {
  let pendingEscape = false;

  for (let index = startIndex + 1; index < input.length; index += 1) {
    const currentCharacter = input[index];

    if (pendingEscape) {
      pendingEscape = false;
      continue;
    }

    if (currentCharacter === '\\') {
      pendingEscape = true;
      continue;
    }

    if (currentCharacter === '"') {
      return index;
    }
  }

  return -1;
}

function hasTopLevelTrackedStringValue(input: string) {
  let depth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const currentCharacter = input[index];

    if (currentCharacter === '"') {
      const stringEnd = findJsonStringEnd(input, index);

      if (stringEnd === -1) {
        return false;
      }

      const stringLiteral = input.slice(index, stringEnd + 1);

      if (depth === 1 && trackedStructuredChunkKeyLiterals.has(stringLiteral)) {
        const colonIndex = skipJsonWhitespace(input, stringEnd + 1);

        if (input[colonIndex] === ':') {
          const valueIndex = skipJsonWhitespace(input, colonIndex + 1);

          if (input[valueIndex] === '"') {
            return true;
          }
        }
      }

      index = stringEnd;
      continue;
    }

    if (currentCharacter === '{' || currentCharacter === '[') {
      depth += 1;
      continue;
    }

    if (currentCharacter === '}' || currentCharacter === ']') {
      depth = Math.max(0, depth - 1);
    }
  }

  return false;
}

function cloneParsedEnvelope(envelope: PartialOpenUiEnvelope): PartialOpenUiEnvelope {
  return {
    ...(envelope.source ? { source: { ...envelope.source } } : {}),
    ...(envelope.summary ? { summary: { ...envelope.summary } } : {}),
  };
}

function getEscapedCharacterValue(escapedCharacter: string) {
  switch (escapedCharacter) {
    case '"':
    case '\\':
    case '/':
      return escapedCharacter;
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    default:
      return escapedCharacter;
  }
}

export function createPartialOpenUiEnvelopeParser() {
  const parsedEnvelope: PartialOpenUiEnvelope = {};
  let activeString: ActiveJsonString | null = null;
  let currentKey: string | null = null;
  let depth = 0;
  let expectingKey = false;
  let expectingValue = false;

  function updateTrackedString(complete: boolean) {
    if (!activeString || (activeString.target !== 'source' && activeString.target !== 'summary')) {
      return;
    }

    parsedEnvelope[activeString.target] = {
      complete,
      value: activeString.value,
    };
  }

  function appendStringValue(value: string) {
    if (!activeString) {
      return;
    }

    if (activeString.target === 'skip') {
      return;
    }

    activeString.value += value;
    updateTrackedString(false);
  }

  function startString(target: JsonStringTarget) {
    activeString = {
      invalidUnicodeEscape: false,
      pendingEscape: false,
      target,
      unicodeDigits: '',
      unicodeRemaining: 0,
      value: '',
    };

    updateTrackedString(false);
  }

  function finishString() {
    if (!activeString) {
      return;
    }

    if (activeString.target === 'key') {
      currentKey = activeString.value;
      expectingKey = false;
    } else if (activeString.target === 'source' || activeString.target === 'summary') {
      updateTrackedString(true);
      expectingValue = false;
    }

    activeString = null;
  }

  function consumeStringCharacter(currentCharacter: string) {
    if (!activeString) {
      return;
    }

    if (activeString.invalidUnicodeEscape) {
      return;
    }

    if (activeString.unicodeRemaining > 0) {
      if (!isHexDigit(currentCharacter)) {
        activeString.invalidUnicodeEscape = true;
        return;
      }

      activeString.unicodeDigits += currentCharacter;
      activeString.unicodeRemaining -= 1;

      if (activeString.unicodeRemaining === 0) {
        appendStringValue(String.fromCharCode(Number.parseInt(activeString.unicodeDigits, 16)));
        activeString.unicodeDigits = '';
      }

      return;
    }

    if (activeString.pendingEscape) {
      activeString.pendingEscape = false;

      if (currentCharacter === 'u') {
        activeString.unicodeDigits = '';
        activeString.unicodeRemaining = 4;
        return;
      }

      appendStringValue(getEscapedCharacterValue(currentCharacter));
      return;
    }

    if (currentCharacter === '\\') {
      activeString.pendingEscape = true;
      return;
    }

    if (currentCharacter === '"') {
      finishString();
      return;
    }

    appendStringValue(currentCharacter);
  }

  function getStringTarget() {
    if (depth === 1 && expectingKey) {
      return 'key';
    }

    if (depth === 1 && expectingValue && (currentKey === 'source' || currentKey === 'summary')) {
      return currentKey;
    }

    return 'skip';
  }

  function append(input: string) {
    for (let index = 0; index < input.length; index += 1) {
      const currentCharacter = input[index];

      if (activeString) {
        consumeStringCharacter(currentCharacter);
        continue;
      }

      if (isJsonWhitespace(currentCharacter)) {
        continue;
      }

      if (currentCharacter === '{') {
        depth += 1;

        if (depth === 1) {
          currentKey = null;
          expectingKey = true;
          expectingValue = false;
        }

        continue;
      }

      if (currentCharacter === '}') {
        if (depth === 1) {
          currentKey = null;
          expectingKey = false;
          expectingValue = false;
        }

        depth = Math.max(0, depth - 1);
        continue;
      }

      if (currentCharacter === '[') {
        depth += 1;
        continue;
      }

      if (currentCharacter === ']') {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (currentCharacter === ',') {
        if (depth === 1) {
          currentKey = null;
          expectingKey = true;
          expectingValue = false;
        }

        continue;
      }

      if (currentCharacter === ':') {
        if (depth === 1 && currentKey !== null) {
          expectingValue = true;
        }

        continue;
      }

      if (currentCharacter === '"') {
        startString(getStringTarget());
      }
    }

    return cloneParsedEnvelope(parsedEnvelope);
  }

  return {
    append,
  };
}

export function isMalformedStructuredChunk(chunk: string) {
  const trimmedChunk = chunk.trim();

  if (!trimmedChunk.startsWith('{') || !trimmedChunk.endsWith('}')) {
    return false;
  }

  if (!trimmedChunk.includes('"source"') && !trimmedChunk.includes('"summary"')) {
    return false;
  }

  return !hasTopLevelTrackedStringValue(trimmedChunk);
}
