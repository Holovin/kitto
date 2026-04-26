import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptBuildRequest } from '@features/builder/types';
import {
  BuilderStreamTimeoutError,
  parseServerSentEvent,
  streamBuilderDefinition,
} from '@features/builder/api/streamGenerate';

const request: PromptBuildRequest = {
  prompt: 'Build a todo app',
  currentSource: '',
  chatHistory: [],
  mode: 'initial',
};

function createDeferred<Result>() {
  let resolvePromise!: (value: Result) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<Result>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

function createTextStream(chunks: string[]) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });
}

function createAbortableTextStream(chunk: string, signal: AbortSignal) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(chunk));

      const closeStream = () => {
        signal.removeEventListener('abort', closeStream);
        controller.close();
      };

      signal.addEventListener('abort', closeStream, { once: true });
    },
  });
}

function createPendingAbortableStream(signal: AbortSignal) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const abortStream = () => {
        signal.removeEventListener('abort', abortStream);
        controller.error(new DOMException('This operation was aborted', 'AbortError'));
      };

      if (signal.aborted) {
        abortStream();
        return;
      }

      signal.addEventListener('abort', abortStream, { once: true });
    },
  });
}

function createStreamRequestOptions(overrides: Partial<Parameters<typeof streamBuilderDefinition>[0]> = {}) {
  return {
    apiBaseUrl: 'http://localhost:8787/api',
    idleTimeoutMs: 45_000,
    maxDurationMs: 120_000,
    onChunk: vi.fn(),
    request,
    ...overrides,
  };
}

describe('parseServerSentEvent', () => {
  it('defaults to a message event for bare data payloads', () => {
    expect(parseServerSentEvent('data: {"source":"root = AppShell([])"}')).toEqual({
      event: 'message',
      data: '{"source":"root = AppShell([])"}',
    });
  });

  it('joins multiline data lines with newlines', () => {
    expect(parseServerSentEvent('data: first line\ndata: second line')).toEqual({
      event: 'message',
      data: 'first line\nsecond line',
    });
  });

  it('parses explicit chunk events', () => {
    expect(parseServerSentEvent('event: chunk\ndata: partial')).toEqual({
      event: 'chunk',
      data: 'partial',
    });
  });

  it('parses explicit error events', () => {
    expect(parseServerSentEvent('event: error\ndata: {"code":"upstream_error"}')).toEqual({
      event: 'error',
      data: '{"code":"upstream_error"}',
    });
  });
});

describe('BuilderStreamTimeoutError', () => {
  it('sets the right message for each timeout kind', () => {
    expect(new BuilderStreamTimeoutError('idle')).toMatchObject({
      kind: 'idle',
      message: 'The generation stream went idle for too long. Please try again.',
      name: 'BuilderStreamTimeoutError',
    });
    expect(new BuilderStreamTimeoutError('max-duration')).toMatchObject({
      kind: 'max-duration',
      message: 'The generation stream exceeded the maximum duration. Please try again.',
      name: 'BuilderStreamTimeoutError',
    });
  });
});

describe('streamBuilderDefinition', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('parses structured JSON chunk events into source deltas across read boundaries and returns the final envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        createTextStream([
          'event: chunk\ndata: {"summary":"Builds a blank app shell.","source":"root = App',
          'Shell([])"}\n\n',
          'event: done\ndata: {"summary":"Builds a blank app shell.","source":"root = AppShell([])","qualityIssues":[{"code":"quality-missing-todo-controls","message":"Todo request did not generate required todo controls.","severity":"blocking-quality","source":"quality"}],"compaction":{"compactedByBytes":false,"compactedByItemLimit":true,"omittedChatMessages":2}}\n\n',
        ]),
        {
          headers: {
            'content-type': 'text/event-stream',
          },
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onChunk = vi.fn();

    const result = await streamBuilderDefinition(createStreamRequestOptions({ onChunk }));

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/api/llm/generate/stream', expect.any(Object));
    expect(onChunk).toHaveBeenNthCalledWith(1, 'root = AppShell([])');
    expect(result).toEqual({
      compaction: {
        compactedByBytes: false,
        compactedByItemLimit: true,
        omittedChatMessages: 2,
      },
      qualityIssues: [
        {
          code: 'quality-missing-todo-controls',
          message: 'Todo request did not generate required todo controls.',
          severity: 'blocking-quality',
          source: 'quality',
        },
      ],
      source: 'root = AppShell([])',
      summary: 'Builds a blank app shell.',
    });
  });

  it('returns summaryExcludeFromLlmContext from the done event when present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          createTextStream([
            'event: chunk\ndata: {"summary":"Updated the app.","source":"root = AppShell([])"}\n\n',
            'event: done\ndata: {"summary":"Updated the app.","summaryExcludeFromLlmContext":true,"source":"root = AppShell([])"}\n\n',
          ]),
          {
            headers: {
              'content-type': 'text/event-stream',
            },
            status: 200,
          },
        ),
      ),
    );

    await expect(streamBuilderDefinition(createStreamRequestOptions())).resolves.toEqual({
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: 'Updated the app.',
      summaryExcludeFromLlmContext: true,
    });
  });

  it('normalizes CRLF-delimited SSE events before parsing them', async () => {
    const onChunk = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          createTextStream([
            'event: chunk\r\ndata: first line\r\ndata: second line\r\n\r\n',
            'event: done\r\ndata: {"source":"first line\\nsecond line"}\r\n\r\n',
          ]),
          {
            headers: {
              'content-type': 'text/event-stream',
            },
            status: 200,
          },
        ),
      ),
    );

    await expect(
      streamBuilderDefinition(createStreamRequestOptions({ onChunk })),
    ).resolves.toEqual({
      qualityIssues: [],
      source: 'first line\nsecond line',
    });

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('first line\nsecond line');
  });

  it('does not create a false event boundary when CRLF is split across read boundaries', async () => {
    const onChunk = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          createTextStream([
            'event: chunk\r\ndata: first line\r',
            '\ndata: second line\r\n\r\n',
            'event: done\r\ndata: {"source":"first line\\nsecond line"}\r\n\r\n',
          ]),
          {
            headers: {
              'content-type': 'text/event-stream',
            },
            status: 200,
          },
        ),
      ),
    );

    await expect(
      streamBuilderDefinition(createStreamRequestOptions({ onChunk })),
    ).resolves.toEqual({
      qualityIssues: [],
      source: 'first line\nsecond line',
    });

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('first line\nsecond line');
  });

  it('normalizes bare carriage returns in SSE streams', async () => {
    const onChunk = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          createTextStream([
            'event: chunk\rdata: root = AppShell([])\r\revent: done\rdata: {"source":"root = AppShell([])"}\r\r',
          ]),
          {
            headers: {
              'content-type': 'text/event-stream',
            },
            status: 200,
          },
        ),
      ),
    );

    await expect(
      streamBuilderDefinition(createStreamRequestOptions({ onChunk })),
    ).resolves.toEqual({
      qualityIssues: [],
      source: 'root = AppShell([])',
    });

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('root = AppShell([])');
  });

  it('includes x-kitto-request-id when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(createTextStream(['event: done\ndata: {"source":"root = AppShell([])"}\n\n']), {
        headers: {
          'content-type': 'text/event-stream',
        },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      streamBuilderDefinition(
        createStreamRequestOptions({
          requestId: 'builder-stream-123',
        }),
      ),
    ).resolves.toEqual({
      qualityIssues: [],
      source: 'root = AppShell([])',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/llm/generate/stream',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-kitto-request-id': 'builder-stream-123',
        }),
      }),
    );
  });

  it('serializes repair linkage fields into the streaming request body', async () => {
    const repairRequest: PromptBuildRequest = {
      ...request,
      invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
      mode: 'repair',
      parentRequestId: 'builder-request-parent',
      validationIssues: [
        {
          code: 'unresolved-reference',
          message: 'This statement was referenced but never defined in the final source.',
          source: 'parser',
          statementId: 'items',
        },
        {
          code: 'quality-missing-todo-controls',
          message: 'Todo request did not generate required todo controls.',
          source: 'quality',
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(createTextStream(['event: done\ndata: {"source":"root = AppShell([])"}\n\n']), {
        headers: {
          'content-type': 'text/event-stream',
        },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await streamBuilderDefinition(
      createStreamRequestOptions({
        requestId: 'builder-request-repair',
        request: repairRequest,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(JSON.parse(String(requestInit?.body))).toEqual({
      prompt: 'Build a todo app',
      currentSource: '',
      chatHistory: [],
      invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
      mode: 'repair',
      parentRequestId: 'builder-request-parent',
      validationIssues: [
        {
          code: 'unresolved-reference',
          message: 'This statement was referenced but never defined in the final source.',
          source: 'parser',
          statementId: 'items',
        },
        {
          code: 'quality-missing-todo-controls',
          message: 'Todo request did not generate required todo controls.',
          source: 'quality',
        },
      ],
    });
  });

  it('throws a normalized error when the server responds with an error event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(createTextStream(['event: error\ndata: {"error":"Upstream failed","code":"upstream_error"}\n\n']), {
          headers: {
            'content-type': 'text/event-stream',
          },
          status: 200,
        }),
      ),
    );

    await expect(
      streamBuilderDefinition({
        ...createStreamRequestOptions(),
      }),
    ).rejects.toMatchObject({
      code: 'upstream_error',
      message: 'Upstream failed',
    });
  });

  it('rejects chunked partial source when the stream ends with an error instead of done', async () => {
    const onChunk = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          createTextStream([
            'event: chunk\ndata: {"summary":"","source":"root = AppShell([])"}\n\n',
            'event: error\ndata: {"error":"Upstream failed","code":"upstream_error"}\n\n',
          ]),
          {
            headers: {
              'content-type': 'text/event-stream',
            },
            status: 200,
          },
        ),
      ),
    );

    await expect(
      streamBuilderDefinition({
        ...createStreamRequestOptions({ onChunk }),
      }),
    ).rejects.toMatchObject({
      code: 'upstream_error',
      message: 'Upstream failed',
    });

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('root = AppShell([])');
  });

  it('throws the parsed backend error for non-ok JSON responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'validation_error', error: 'Prompt too large.' }), {
          headers: {
            'content-type': 'application/json',
          },
          status: 400,
        }),
      ),
    );

    await expect(
      streamBuilderDefinition({
        ...createStreamRequestOptions(),
      }),
    ).rejects.toMatchObject({
      code: 'validation_error',
      message: 'Prompt too large.',
      status: 400,
    });
  });

  it('throws when the stream finishes with a malformed done payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(createTextStream(['event: done\ndata: not-json\n\n']), {
          headers: {
            'content-type': 'text/event-stream',
          },
          status: 200,
        }),
      ),
    );

    await expect(
      streamBuilderDefinition({
        ...createStreamRequestOptions(),
      }),
    ).rejects.toThrow('Received a malformed "done" event from the backend stream.');
  });

  it('throws when the done payload omits source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          createTextStream([
            'event: chunk\ndata: {"source":"root = App\n\n',
            'event: chunk\ndata:Shell([])"}\n\n',
            'event: done\ndata: {"model":"gpt-5.4-mini"}\n\n',
          ]),
          {
            headers: {
              'content-type': 'text/event-stream',
            },
            status: 200,
          },
        ),
      ),
    );

    await expect(
      streamBuilderDefinition({
        ...createStreamRequestOptions(),
      }),
    ).rejects.toThrow('Received an invalid "done" event from the backend stream.');
  });

  it('preserves meaningful leading spaces in plain-text chunk data', async () => {
    const onChunk = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          createTextStream([
            'event: chunk\ndata:   Text("hero", "Leading spaces matter")\n\n',
            'event: done\ndata: {"model":"gpt-5.4-mini","source":"  Text(\\"hero\\", \\"Leading spaces matter\\")"}\n\n',
          ]),
          {
            headers: {
              'content-type': 'text/event-stream',
            },
            status: 200,
          },
        ),
      ),
    );

    await expect(
      streamBuilderDefinition({
        ...createStreamRequestOptions({ onChunk }),
      }),
    ).resolves.toEqual({
      qualityIssues: [],
      source: '  Text("hero", "Leading spaces matter")',
    });

    expect(onChunk).toHaveBeenCalledWith('  Text("hero", "Leading spaces matter")');
  });

  it('emits at least one summary update before the done event finishes the stream', async () => {
    const onChunk = vi.fn();
    const onSummary = vi.fn();
    const allowDone = createDeferred<void>();
    const firstSummarySeen = createDeferred<void>();
    let doneEventSent = false;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();

              controller.enqueue(encoder.encode('event: chunk\ndata: {"summary":"Builds a\n\n'));

              allowDone.promise.then(() => {
                controller.enqueue(encoder.encode('event: chunk\ndata:  todo list","source":"root = AppShell([])"}\n\n'));
                doneEventSent = true;
                controller.enqueue(
                  encoder.encode(
                    'event: done\ndata: {"summary":"Builds a todo list","source":"root = AppShell([])"}\n\n',
                  ),
                );
                controller.close();
              });
            },
          }),
          {
            headers: {
              'content-type': 'text/event-stream',
            },
            status: 200,
          },
        ),
      ),
    );

    onSummary.mockImplementation(() => {
      if (onSummary.mock.calls.length === 1) {
        firstSummarySeen.resolve();
      }
    });

    const streamPromise = streamBuilderDefinition({
      ...createStreamRequestOptions({ onChunk, onSummary }),
    });

    await firstSummarySeen.promise;
    expect(onSummary).toHaveBeenCalledTimes(1);
    expect(onSummary).toHaveBeenCalledWith('Builds a');
    expect(doneEventSent).toBe(false);

    allowDone.resolve();

    await expect(
      streamPromise,
    ).resolves.toEqual({
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: 'Builds a todo list',
    });

    expect(onSummary).toHaveBeenCalledWith('Builds a');
    expect(onSummary).toHaveBeenLastCalledWith('Builds a todo list');
    expect(onChunk).toHaveBeenCalledWith('root = AppShell([])');
  });

  it('logs and skips malformed structured chunk events before continuing the stream', async () => {
    const onChunk = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          createTextStream([
            'event: chunk\ndata: {"source": }\n\n',
            'event: chunk\ndata: {"source":"root = AppShell([])"}\n\n',
            'event: done\ndata: {"source":"root = AppShell([])"}\n\n',
          ]),
          {
            headers: {
              'content-type': 'text/event-stream',
            },
            status: 200,
          },
        ),
      ),
    );

    await expect(
      streamBuilderDefinition({
        ...createStreamRequestOptions({ onChunk }),
      }),
    ).resolves.toEqual({
      qualityIssues: [],
      source: 'root = AppShell([])',
    });

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('root = AppShell([])');
    expect(warnSpy).toHaveBeenCalledWith('[builder.stream] Ignoring malformed structured chunk.');
  });

  it('throws when the stream ends without a done event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(createTextStream(['event: chunk\ndata: root = AppShell([])\n\n']), {
          headers: {
            'content-type': 'text/event-stream',
          },
          status: 200,
        }),
      ),
    );

    await expect(
      streamBuilderDefinition({
        ...createStreamRequestOptions(),
      }),
    ).rejects.toThrow('Stream ended before done event');
  });

  it('treats an aborted stream without done as an abort instead of returning partial source', async () => {
    const abortController = new AbortController();
    const onChunk = vi.fn((chunk: string) => {
      expect(chunk).toBe('root = AppShell([])');
      abortController.abort();
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(createAbortableTextStream('event: chunk\ndata: root = AppShell([])\n\n', abortController.signal), {
          headers: {
            'content-type': 'text/event-stream',
          },
          status: 200,
        }),
      ),
    );

    await expect(
      streamBuilderDefinition({
        ...createStreamRequestOptions({
          onChunk,
          signal: abortController.signal,
        }),
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('cancels the reader and removes abort listeners when aborted mid-stream', async () => {
    const abortController = new AbortController();
    const addEventListenerSpy = vi.spyOn(abortController.signal, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(abortController.signal, 'removeEventListener');
    const readResult = createDeferred<ReadableStreamReadResult<Uint8Array>>();
    const reader = {
      read: vi.fn(() => readResult.promise),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    let requestSignal: AbortSignal | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal as AbortSignal;
        requestSignal?.addEventListener(
          'abort',
          () => {
            readResult.reject(new DOMException('This operation was aborted', 'AbortError'));
          },
          { once: true },
        );

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'text/event-stream',
          }),
          body: {
            getReader: () => reader,
          },
        } as unknown as Response);
      }),
    );

    const streamPromise = streamBuilderDefinition(
      createStreamRequestOptions({
        signal: abortController.signal,
      }),
    );

    abortController.abort();

    await expect(streamPromise).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(requestSignal?.aborted).toBe(true);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(addEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('removes the linked abort listener after a successful stream', async () => {
    const abortController = new AbortController();
    const addEventListenerSpy = vi.spyOn(abortController.signal, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(abortController.signal, 'removeEventListener');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(createTextStream(['event: done\ndata: {"source":"root = AppShell([])"}\n\n']), {
          headers: {
            'content-type': 'text/event-stream',
          },
          status: 200,
        }),
      ),
    );

    await expect(
      streamBuilderDefinition({
        ...createStreamRequestOptions({
          signal: abortController.signal,
        }),
      }),
    ).resolves.toEqual({
      qualityIssues: [],
      source: 'root = AppShell([])',
    });

    expect(addEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('removes the linked abort listener after a stream error', async () => {
    const abortController = new AbortController();
    const addEventListenerSpy = vi.spyOn(abortController.signal, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(abortController.signal, 'removeEventListener');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(createTextStream(['event: error\ndata: {"error":"Upstream failed","code":"upstream_error"}\n\n']), {
          headers: {
            'content-type': 'text/event-stream',
          },
          status: 200,
        }),
      ),
    );

    await expect(
      streamBuilderDefinition({
        ...createStreamRequestOptions({
          signal: abortController.signal,
        }),
      }),
    ).rejects.toMatchObject({
      code: 'upstream_error',
      message: 'Upstream failed',
    });

    expect(addEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('fails the stream on idle timeout and aborts the request signal', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let requestSignal: AbortSignal | null | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal;

        return Promise.resolve(
          new Response(createPendingAbortableStream(init?.signal as AbortSignal), {
            headers: {
              'content-type': 'text/event-stream',
            },
            status: 200,
          }),
        );
      }),
    );

    const streamPromise = streamBuilderDefinition(
      createStreamRequestOptions({
        idleTimeoutMs: 30_000,
        maxDurationMs: 120_000,
        onTimeout,
      }),
    );
    const rejection = expect(streamPromise).rejects.toMatchObject({
      kind: 'idle',
      name: 'BuilderStreamTimeoutError',
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(onTimeout).toHaveBeenCalledWith('idle');
    expect(requestSignal?.aborted).toBe(true);
  });

  it('fails the stream on max duration timeout and aborts the request signal', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let requestSignal: AbortSignal | null | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal;

        return Promise.resolve(
          new Response(createPendingAbortableStream(init?.signal as AbortSignal), {
            headers: {
              'content-type': 'text/event-stream',
            },
            status: 200,
          }),
        );
      }),
    );

    const streamPromise = streamBuilderDefinition(
      createStreamRequestOptions({
        idleTimeoutMs: 45_000,
        maxDurationMs: 15_000,
        onTimeout,
      }),
    );
    const rejection = expect(streamPromise).rejects.toMatchObject({
      kind: 'max-duration',
      name: 'BuilderStreamTimeoutError',
    });

    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(onTimeout).toHaveBeenCalledWith('max-duration');
    expect(requestSignal?.aborted).toBe(true);
  });
});
