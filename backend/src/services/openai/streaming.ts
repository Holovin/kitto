import { APIUserAbortError } from 'openai';
import type { AppEnv } from '#backend/env.js';
import { getByteLength, getRawStructuredOutputMaxBytes } from '#backend/limits.js';
import { createRawStructuredOutputLimitError } from './envelope.js';

interface AbortableStream {
  abort: () => void;
}

interface FinalizableStreamResponse {
  _request_id?: unknown;
  usage?: unknown;
}

export interface OpenAiResponseStreamState {
  finalResponse: FinalizableStreamResponse | null;
  streamedText: string;
}

interface ConsumeOpenAiResponseStreamOptions {
  getRequestId?: () => string | null | undefined;
}

type OpenAiResponseStreamEvent = {
  delta?: string;
  type?: string;
};

type OpenAiResponseStream = AsyncIterable<OpenAiResponseStreamEvent> &
  AbortableStream & {
    finalResponse: () => Promise<FinalizableStreamResponse>;
  };

export function isAbortedRequestError(error: unknown, signal?: AbortSignal) {
  return error instanceof APIUserAbortError || signal?.aborted === true;
}

function throwIfAborted(signal?: AbortSignal, stream?: AbortableStream) {
  if (!signal?.aborted) {
    return;
  }

  stream?.abort?.();
  throw new APIUserAbortError();
}

function assertDeltaWithinLimit(env: AppEnv, streamedTextBytes: number, stream: AbortableStream) {
  const rawLimitBytes = getRawStructuredOutputMaxBytes(env);

  if (streamedTextBytes > rawLimitBytes) {
    stream.abort();
    throw createRawStructuredOutputLimitError(streamedTextBytes, rawLimitBytes);
  }
}

export function extractResponseText(response: unknown) {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const directOutputText = (response as { output_text?: unknown }).output_text;

  if (typeof directOutputText === 'string' && directOutputText.trim()) {
    return directOutputText;
  }

  const outputItems = (response as { output?: unknown }).output;

  if (!Array.isArray(outputItems)) {
    return null;
  }

  const collectedText = outputItems
    .flatMap((item) => {
      if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'message') {
        return [];
      }

      const content = (item as { content?: unknown }).content;

      if (!Array.isArray(content)) {
        return [];
      }

      return content.flatMap((part) => {
        if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'output_text') {
          return [];
        }

        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? [text] : [];
      });
    })
    .join('');

  return collectedText || null;
}

function logStreamFinalResponseMismatch(response: FinalizableStreamResponse, streamedText: string, finalResponseText: string | null) {
  if (!finalResponseText || !streamedText || finalResponseText === streamedText) {
    return;
  }

  const requestId = typeof response._request_id === 'string' && response._request_id.trim() ? response._request_id : 'unknown';

  console.warn(
    `[openai.responses.stream] finalized response text differed from streamed deltas; request_id=${requestId} streamed_bytes=${getByteLength(streamedText)} final_bytes=${getByteLength(finalResponseText)}`,
  );
}

function attachRequestId(response: FinalizableStreamResponse, requestId: string | null | undefined) {
  if (!requestId || (typeof response._request_id === 'string' && response._request_id.trim())) {
    return response;
  }

  try {
    Object.defineProperty(response, '_request_id', {
      configurable: true,
      enumerable: false,
      value: requestId,
    });

    return response;
  } catch {
    return {
      ...response,
      _request_id: requestId,
    };
  }
}

export async function consumeOpenAiResponseStream(
  env: AppEnv,
  stream: OpenAiResponseStream,
  onTextDelta: (delta: string) => Promise<void> | void,
  signal: AbortSignal | undefined,
  state: OpenAiResponseStreamState,
  options: ConsumeOpenAiResponseStreamOptions = {},
) {
  let streamedTextBytes = 0;
  let hasAbortedStream = false;
  const abortStream = () => {
    if (hasAbortedStream) {
      return;
    }

    hasAbortedStream = true;
    stream.abort();
  };
  const handleAbort = () => {
    abortStream();
  };

  if (signal?.aborted) {
    handleAbort();
    throw new APIUserAbortError();
  }

  signal?.addEventListener('abort', handleAbort, { once: true });

  try {
    for await (const event of stream) {
      throwIfAborted(signal, { abort: abortStream });

      if (event.type === 'response.output_text.delta' && event.delta) {
        throwIfAborted(signal, { abort: abortStream });
        streamedTextBytes += Buffer.byteLength(event.delta, 'utf8');
        assertDeltaWithinLimit(env, streamedTextBytes, { abort: abortStream });
        state.streamedText += event.delta;
        await onTextDelta(event.delta);
      }
    }

    throwIfAborted(signal, { abort: abortStream });
    state.finalResponse = attachRequestId(await stream.finalResponse(), options.getRequestId?.());
    throwIfAborted(signal, { abort: abortStream });
    const finalResponseText = extractResponseText(state.finalResponse);
    logStreamFinalResponseMismatch(state.finalResponse, state.streamedText, finalResponseText);
    return finalResponseText || state.streamedText;
  } finally {
    signal?.removeEventListener('abort', handleAbort);
  }
}
