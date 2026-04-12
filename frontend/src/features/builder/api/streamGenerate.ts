import type { BuilderLlmRequest } from '@features/builder/types';

interface StreamBuilderDefinitionOptions {
  apiBaseUrl: string;
  onChunk: (chunk: string) => void;
  request: BuilderLlmRequest;
  signal?: AbortSignal;
}

interface StreamDonePayload {
  model?: string;
  source?: string;
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
      data.push(line.slice(5).trimStart());
    }
  }

  return {
    event,
    data: data.join('\n'),
  };
}

async function getResponseErrorMessage(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? `Request failed with status ${response.status}`;
  }

  const text = await response.text();
  return text || `Request failed with status ${response.status}`;
}

export async function streamBuilderDefinition({
  apiBaseUrl,
  onChunk,
  request,
  signal,
}: StreamBuilderDefinitionOptions) {
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
    throw new Error(await getResponseErrorMessage(response));
  }

  if (!response.body) {
    throw new Error('Streaming response body is not available.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullSource = '';

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
        throw new Error(parsedEvent.data || 'The backend stream returned an error.');
      }

      if (parsedEvent.event === 'done') {
        let payload: StreamDonePayload;

        try {
          payload = JSON.parse(parsedEvent.data) as StreamDonePayload;
        } catch {
          throw new Error('Received a malformed "done" event from the backend stream.');
        }

        return payload.source ?? fullSource;
      }
    }

    if (done) {
      break;
    }
  }

  if (!fullSource.trim()) {
    throw new Error('The model stream ended before it returned any OpenUI source.');
  }

  return fullSource;
}
