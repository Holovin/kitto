import type { BuilderLlmRequest, BuilderLlmRequestCompaction, BuilderQualityIssue } from '@features/builder/types';
import { createBuilderRequestError } from './requestErrors';
import { serializeBuilderLlmRequest } from './requestBody';

export type BuilderStreamTimeoutKind = 'idle' | 'max-duration';

interface StreamBuilderDefinitionOptions {
  apiBaseUrl: string;
  idleTimeoutMs: number;
  maxDurationMs: number;
  onChunk: (chunk: string) => void;
  onSummary?: (summary: string) => void;
  onTimeout?: (kind: BuilderStreamTimeoutKind) => void;
  requestId?: string;
  request: BuilderLlmRequest;
  signal?: AbortSignal;
}

interface StreamDonePayload {
  compaction?: BuilderLlmRequestCompaction;
  model?: string;
  qualityIssues?: BuilderQualityIssue[];
  source?: string;
  summary?: string;
}

interface StreamBuilderDefinitionResult {
  compaction?: BuilderLlmRequestCompaction;
  qualityIssues: BuilderQualityIssue[];
  source: string;
  summary?: string;
}

interface PartialJsonStringValue {
  complete: boolean;
  value: string;
}

interface PartialOpenUiEnvelope {
  source?: PartialJsonStringValue;
  summary?: PartialJsonStringValue;
}

export class BuilderStreamTimeoutError extends Error {
  readonly kind: BuilderStreamTimeoutKind;

  constructor(kind: BuilderStreamTimeoutKind) {
    super(
      kind === 'idle'
        ? 'The generation stream went idle for too long. Please try again.'
        : 'The generation stream exceeded the maximum duration. Please try again.',
    );
    this.name = 'BuilderStreamTimeoutError';
    this.kind = kind;
  }
}

function normalizeSseDataLine(line: string) {
  const value = line.slice(5);
  return value.startsWith(' ') ? value.slice(1) : value;
}

function createAbortError() {
  try {
    return new DOMException('This operation was aborted', 'AbortError');
  } catch {
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    return error;
  }
}

function createLinkedAbortController(signal?: AbortSignal) {
  const abortController = new AbortController();
  const handleAbort = () => abortController.abort();

  if (signal?.aborted) {
    handleAbort();
  } else {
    signal?.addEventListener('abort', handleAbort, { once: true });
  }

  return {
    abortController,
    cleanup() {
      signal?.removeEventListener('abort', handleAbort);
    },
  };
}

function parseServerSentEvent(eventBlock: string) {
  const lines = eventBlock.split('\n').filter(Boolean);
  let event = 'message';
  const data: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      data.push(normalizeSseDataLine(line));
    }
  }

  return {
    event,
    data: data.join('\n'),
  };
}

function hasDoneSource(payload: StreamDonePayload): payload is StreamDonePayload & { source: string } {
  return typeof payload.source === 'string' && payload.source.length > 0;
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

function parsePartialOpenUiEnvelope(input: string): PartialOpenUiEnvelope {
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

async function getResponseError(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return createBuilderRequestError(await response.json(), {
      message: `Request failed with status ${response.status}.`,
      status: response.status,
    });
  }

  return createBuilderRequestError(await response.text(), {
    message: `Request failed with status ${response.status}.`,
    status: response.status,
  });
}

export async function streamBuilderDefinition({
  apiBaseUrl,
  idleTimeoutMs,
  maxDurationMs,
  onChunk,
  onSummary,
  onTimeout,
  requestId,
  request,
  signal,
}: StreamBuilderDefinitionOptions): Promise<StreamBuilderDefinitionResult> {
  const { abortController, cleanup } = createLinkedAbortController(signal);
  let idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let maxDurationTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let timeoutError: BuilderStreamTimeoutError | null = null;

  const clearIdleTimeout = () => {
    if (!idleTimeoutId) {
      return;
    }

    clearTimeout(idleTimeoutId);
    idleTimeoutId = null;
  };

  const clearMaxDurationTimeout = () => {
    if (!maxDurationTimeoutId) {
      return;
    }

    clearTimeout(maxDurationTimeoutId);
    maxDurationTimeoutId = null;
  };

  const clearTimeouts = () => {
    clearIdleTimeout();
    clearMaxDurationTimeout();
  };

  const abortForTimeout = (kind: BuilderStreamTimeoutKind) => {
    if (timeoutError || abortController.signal.aborted) {
      return;
    }

    timeoutError = new BuilderStreamTimeoutError(kind);
    onTimeout?.(kind);
    abortController.abort();
  };

  const restartIdleTimeout = () => {
    if (idleTimeoutMs <= 0) {
      return;
    }

    clearIdleTimeout();
    idleTimeoutId = setTimeout(() => {
      abortForTimeout('idle');
    }, idleTimeoutMs);
  };

  if (maxDurationMs > 0) {
    maxDurationTimeoutId = setTimeout(() => {
      abortForTimeout('max-duration');
    }, maxDurationMs);
  }

  try {
    const response = await fetch(`${apiBaseUrl}/llm/generate/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(requestId ? { 'x-kitto-request-id': requestId } : {}),
      },
      body: serializeBuilderLlmRequest(request),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw await getResponseError(response);
    }

    if (!response.body) {
      throw new Error('Streaming response body is not available.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawStructuredEnvelope = '';
    let lastParsedSource = '';
    let lastParsedSummary = '';
    let receivedDone = false;
    let donePayload: StreamDonePayload | undefined;
    let streamMode: 'plain' | 'structured' | 'unknown' = 'unknown';

    restartIdleTimeout();

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), {
        stream: !done,
      });

      const eventBlocks = buffer.split('\n\n');
      buffer = eventBlocks.pop() ?? '';

      for (const eventBlock of eventBlocks) {
        const parsedEvent = parseServerSentEvent(eventBlock);

        if (parsedEvent.event === 'chunk') {
          restartIdleTimeout();

          if (streamMode === 'unknown') {
            const firstMeaningfulCharacter = parsedEvent.data.trimStart().charAt(0);

            if (firstMeaningfulCharacter === '{') {
              streamMode = 'structured';
            } else if (firstMeaningfulCharacter) {
              streamMode = 'plain';
            }
          }

          if (streamMode === 'structured') {
            rawStructuredEnvelope += parsedEvent.data;
            const partialEnvelope = parsePartialOpenUiEnvelope(rawStructuredEnvelope);
            const nextSource = partialEnvelope.source?.value ?? '';
            const nextSummary = partialEnvelope.summary?.value;

            if (typeof nextSummary === 'string' && nextSummary !== lastParsedSummary) {
              lastParsedSummary = nextSummary;
              onSummary?.(nextSummary);
            }

            if (nextSource && nextSource.startsWith(lastParsedSource)) {
              const delta = nextSource.slice(lastParsedSource.length);

              if (delta) {
                lastParsedSource = nextSource;
                onChunk(delta);
              }
            } else if (nextSource) {
              lastParsedSource = nextSource;
              onChunk(nextSource);
            }

            continue;
          }

          onChunk(parsedEvent.data);
          continue;
        }

        if (parsedEvent.event === 'error') {
          throw createBuilderRequestError(parsedEvent.data, {
            message: 'The backend stream returned an error.',
          });
        }

        if (parsedEvent.event === 'done') {
          restartIdleTimeout();
          try {
            donePayload = JSON.parse(parsedEvent.data) as StreamDonePayload;
          } catch {
            throw new Error('Received a malformed "done" event from the backend stream.');
          }

          receivedDone = true;
          break;
        }
      }

      if (receivedDone) {
        break;
      }

      if (done) {
        break;
      }
    }

    if (receivedDone && donePayload) {
      if (!hasDoneSource(donePayload)) {
        throw new Error('Received an invalid "done" event from the backend stream.');
      }

      return {
        compaction: donePayload.compaction,
        qualityIssues: donePayload.qualityIssues ?? [],
        source: donePayload.source,
        summary: donePayload.summary,
      };
    }

    if (timeoutError) {
      throw timeoutError;
    }

    if (signal?.aborted || abortController.signal.aborted) {
      throw createAbortError();
    }

    throw new Error('Stream ended before done event');
  } catch (error) {
    if (timeoutError) {
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeouts();
    cleanup();
  }
}
