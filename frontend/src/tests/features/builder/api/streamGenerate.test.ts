import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuilderLlmRequest } from '@features/builder/types';
import { streamBuilderDefinition } from '@features/builder/api/streamGenerate';

const request: BuilderLlmRequest = {
  prompt: 'Build a todo app',
  currentSource: '',
  chatHistory: [],
};

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

describe('streamBuilderDefinition', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('streams chunk events across read boundaries and returns the final source', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        createTextStream([
          'event: chunk\ndata: root = App',
          'Shell([])\n\n',
          'event: chunk\ndata: // trailing comment\n\n',
          'event: done\ndata: {"source":"root = AppShell([])// trailing comment","compaction":{"compactedByBytes":false,"compactedByItemLimit":true,"omittedChatMessages":2}}\n\n',
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

    const result = await streamBuilderDefinition({
      apiBaseUrl: 'http://localhost:8787/api',
      onChunk,
      request,
    });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/api/llm/generate/stream', expect.any(Object));
    expect(onChunk).toHaveBeenNthCalledWith(1, 'root = AppShell([])');
    expect(onChunk).toHaveBeenNthCalledWith(2, '// trailing comment');
    expect(result).toEqual({
      compaction: {
        compactedByBytes: false,
        compactedByItemLimit: true,
        omittedChatMessages: 2,
      },
      source: 'root = AppShell([])// trailing comment',
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
        apiBaseUrl: 'http://localhost:8787/api',
        onChunk: vi.fn(),
        request,
      }),
    ).rejects.toMatchObject({
      code: 'upstream_error',
      message: 'Upstream failed',
    });
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
        apiBaseUrl: 'http://localhost:8787/api',
        onChunk: vi.fn(),
        request,
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
        apiBaseUrl: 'http://localhost:8787/api',
        onChunk: vi.fn(),
        request,
      }),
    ).rejects.toThrow('Received a malformed "done" event from the backend stream.');
  });

  it('falls back to accumulated chunks when the done payload omits source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          createTextStream([
            'event: chunk\ndata: root = App\n\n',
            'event: chunk\ndata:Shell([])\n\n',
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
        apiBaseUrl: 'http://localhost:8787/api',
        onChunk: vi.fn(),
        request,
      }),
    ).resolves.toEqual({
      source: 'root = AppShell([])',
    });
  });

  it('throws when the stream ends before any source arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(createTextStream([]), {
          headers: {
            'content-type': 'text/event-stream',
          },
          status: 200,
        }),
      ),
    );

    await expect(
      streamBuilderDefinition({
        apiBaseUrl: 'http://localhost:8787/api',
        onChunk: vi.fn(),
        request,
      }),
    ).rejects.toThrow('The model stream ended before it returned any OpenUI source.');
  });
});
