import type { BuilderLlmRequest, BuilderLlmRequestCompaction } from '@features/builder/types';
import { createBuilderRequestError } from './requestErrors';

interface StreamBuilderDefinitionOptions {
  apiBaseUrl: string;
  onChunk: (chunk: string) => void;
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
  onChunk,
  request,
  signal,
}: StreamBuilderDefinitionOptions): Promise<StreamBuilderDefinitionResult> {
  const response = await fetch(`${apiBaseUrl}/llm/generate/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(request),
    signal,
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
  let fullSource = '';
  let receivedDone = false;
  let donePayload: StreamDonePayload | undefined;

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
        fullSource += parsedEvent.data;
        onChunk(parsedEvent.data);
        continue;
      }

      if (parsedEvent.event === 'error') {
        throw createBuilderRequestError(parsedEvent.data, {
          message: 'The backend stream returned an error.',
        });
      }

      if (parsedEvent.event === 'done') {
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
    return {
      compaction: donePayload.compaction,
      source: donePayload.source ?? fullSource,
    };
  }

  if (signal?.aborted) {
    throw createAbortError();
  }

  throw new Error('Stream ended before done event');
}
