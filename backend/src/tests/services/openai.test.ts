import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptBuildRequest } from '../../prompts/openui.js';
import { UpstreamFailureError } from '../../errors/publicError.js';
import { createTestEnv } from '../createTestEnv.js';

const { MockApiUserAbortError, responsesCreateMock, responsesStreamMock } = vi.hoisted(() => {
  class HoistedMockApiUserAbortError extends Error {
    constructor() {
      super('Request was aborted.');
      this.name = 'APIUserAbortError';
    }
  }

  return {
    MockApiUserAbortError: HoistedMockApiUserAbortError,
    responsesCreateMock: vi.fn(),
    responsesStreamMock: vi.fn(),
  };
});

vi.mock('openai', () => {
  class MockOpenAI {
    responses = {
      create: responsesCreateMock,
      stream: responsesStreamMock,
    };

    constructor(_options?: unknown) {}
  }

  return {
    APIUserAbortError: MockApiUserAbortError,
    default: MockOpenAI,
  };
});

import { generateOpenUiSource, streamOpenUiSource } from '../../services/openai.js';

const request: PromptBuildRequest = {
  chatHistory: [],
  currentSource: '',
  mode: 'initial',
  prompt: 'Build a todo app',
};

const repairRequest: PromptBuildRequest = {
  ...request,
  mode: 'repair',
};

function createMockResponseStream(events: unknown[], finalResponse: unknown) {
  let aborted = false;

  return {
    abort: vi.fn(() => {
      aborted = true;
    }),
    finalResponse: vi.fn(async () => finalResponse),
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        if (aborted) {
          return;
        }

        yield event;
      }
    },
  };
}

function expectStructuredOutputRequest(callArgument: unknown, options?: { temperature?: number }) {
  expect(callArgument).toEqual(
    expect.objectContaining({
      max_output_tokens: 25_000,
      temperature: options?.temperature ?? 0.6,
      text: {
        format: {
          type: 'json_schema',
          name: 'kitto_openui_source',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['source'],
            properties: {
              source: {
                type: 'string',
              },
            },
          },
        },
      },
    }),
  );
}

describe('generateOpenUiSource', () => {
  afterEach(() => {
    responsesCreateMock.mockReset();
    responsesStreamMock.mockReset();
  });

  it('extracts source from a structured non-stream response', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-1',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toBe('root = AppShell([])');

    expect(responsesCreateMock).toHaveBeenCalledTimes(1);
    expectStructuredOutputRequest(responsesCreateMock.mock.calls[0]?.[0]);
  });

  it('uses lower temperature for repair requests while keeping explicit output limits', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-repair',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, repairRequest)).resolves.toBe('root = AppShell([])');

    expect(responsesCreateMock).toHaveBeenCalledTimes(1);
    expectStructuredOutputRequest(responsesCreateMock.mock.calls[0]?.[0], { temperature: 0.2 });
    expect(responsesCreateMock.mock.calls[0]?.[0]).not.toHaveProperty('seed');
  });

  it('rejects malformed structured JSON', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-2',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: 'not-json',
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('rejects structured envelopes missing source', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-3',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        notSource: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('rejects empty structured sources', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-4',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        source: '',
      }),
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('rejects structured envelopes with extra properties', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-5',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        source: 'root = AppShell([])',
        extra: true,
      }),
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('rejects raw structured responses above the raw envelope limit', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-6',
      LLM_OUTPUT_MAX_BYTES: 10,
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        source: '1234567890',
      }),
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('rejects extracted structured sources above the source limit', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-7',
      LLM_OUTPUT_MAX_BYTES: 50,
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        source: 'x'.repeat(51),
      }),
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('keeps the legacy plain-text path when structured output is disabled', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-8',
      LLM_STRUCTURED_OUTPUT: false,
    });
    responsesCreateMock.mockResolvedValue({
      output_text: '```openui\nroot = AppShell([])\n```',
    });

    await expect(generateOpenUiSource(env, request)).resolves.toBe('root = AppShell([])');

    expect(responsesCreateMock).toHaveBeenCalledTimes(1);
    expect(responsesCreateMock.mock.calls[0]?.[0]).not.toHaveProperty('text');
  });
});

describe('streamOpenUiSource', () => {
  afterEach(() => {
    responsesCreateMock.mockReset();
    responsesStreamMock.mockReset();
  });

  it('stops before processing a subsequent event after abort is observed', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-9',
    });
    const abortController = new AbortController();
    const onTextDelta = vi.fn((delta: string) => {
      if (delta === '{"source":"root = ') {
        abortController.abort();
      }
    });
    const stream = createMockResponseStream(
      [
        { type: 'response.output_text.delta', delta: '{"source":"root = ' },
        { type: 'response.output_text.delta', delta: 'AppShell([])"}' },
      ],
      { output_text: '{"source":"root = AppShell([])"}' },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta, abortController.signal)).rejects.toBeInstanceOf(
      MockApiUserAbortError,
    );

    expect(onTextDelta).toHaveBeenCalledTimes(1);
    expect(onTextDelta).toHaveBeenCalledWith('{"source":"root = ');
    expect(stream.abort).toHaveBeenCalledTimes(1);
    expect(stream.finalResponse).not.toHaveBeenCalled();
  });

  it('stops before calling onTextDelta when abort is observed mid-event processing', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-10',
    });
    const abortController = new AbortController();
    const onTextDelta = vi.fn();
    const abortingEvent = {
      type: 'response.output_text.delta',
      get delta() {
        abortController.abort();
        return '{"source":"root = AppShell([])"}';
      },
    };
    const stream = createMockResponseStream([abortingEvent], { output_text: '{"source":"root = AppShell([])"}' });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta, abortController.signal)).rejects.toBeInstanceOf(
      MockApiUserAbortError,
    );

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(stream.abort).toHaveBeenCalledTimes(1);
    expect(stream.finalResponse).not.toHaveBeenCalled();
  });

  it('accumulates structured JSON chunks but returns the extracted source', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-11',
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream(
      [
        { type: 'response.output_text.delta', delta: '{"source":"root = ' },
        { type: 'response.output_text.delta', delta: 'AppShell([])"}' },
      ],
      { output_text: '{"source":"root = AppShell([])"}' },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).resolves.toBe('root = AppShell([])');

    expect(onTextDelta).toHaveBeenNthCalledWith(1, '{"source":"root = ');
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'AppShell([])"}');
    expectStructuredOutputRequest(responsesStreamMock.mock.calls[0]?.[0]);
  });

  it('rejects malformed structured streamed output', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-12',
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream([{ type: 'response.output_text.delta', delta: 'not-json' }], {
      output_text: 'not-json',
    });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('rejects truncated structured streamed output', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-13',
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream([{ type: 'response.output_text.delta', delta: '{"source":' }], {
      output_text: '{"source":',
    });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('rejects empty structured streamed output envelopes', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-14',
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream([{ type: 'response.output_text.delta', delta: '{"source":""}' }], {
      output_text: '{"source":""}',
    });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('rejects structured streamed output envelopes with extra properties', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-15',
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream(
      [{ type: 'response.output_text.delta', delta: '{"source":"root = AppShell([])","extra":true}' }],
      {
        output_text: '{"source":"root = AppShell([])","extra":true}',
      },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('aborts the upstream stream when raw structured output exceeds the raw envelope limit', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-16',
      LLM_OUTPUT_MAX_BYTES: 10,
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream([{ type: 'response.output_text.delta', delta: '{"source":"1234567890"}' }], {
      output_text: '{"source":"1234567890"}',
    });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).rejects.toBeInstanceOf(UpstreamFailureError);

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(stream.abort).toHaveBeenCalledTimes(1);
    expect(stream.finalResponse).not.toHaveBeenCalled();
  });

  it('keeps the legacy plain-text streaming path when structured output is disabled', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-17',
      LLM_STRUCTURED_OUTPUT: false,
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream([{ type: 'response.output_text.delta', delta: '```openui\nroot = AppShell([])\n```' }], {
      output_text: '```openui\nroot = AppShell([])\n```',
    });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).resolves.toBe('root = AppShell([])');

    expect(onTextDelta).toHaveBeenCalledWith('```openui\nroot = AppShell([])\n```');
    expect(responsesStreamMock.mock.calls[0]?.[0]).not.toHaveProperty('text');
  });
});
