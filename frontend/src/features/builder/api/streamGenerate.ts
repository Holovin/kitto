import type { BuilderLlmRequest, BuilderLlmRequestCompaction } from '@features/builder/types';
import { createBuilderRequestError } from './requestErrors';

export type BuilderStreamTimeoutKind = 'idle' | 'max-duration';

interface StreamBuilderDefinitionOptions {
  apiBaseUrl: string;
  idleTimeoutMs: number;
  maxDurationMs: number;
  onChunk: (chunk: string) => void;
  onTimeout?: (kind: BuilderStreamTimeoutKind) => void;
  request: BuilderLlmRequest;
  signal?: AbortSignal;
}

interface StreamDonePayload {
  compaction?: BuilderLlmRequestCompaction;
  model?: string;
  source?: string;
}

interface StreamBuilderDefinitionResult {
  compaction?: BuilderLlmRequestCompaction;
  source: string;
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
  onTimeout,
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
      },
      body: JSON.stringify(request),
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
    let receivedDone = false;
    let donePayload: StreamDonePayload | undefined;

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
        source: donePayload.source,
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
