import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptBuildRequest } from '../../prompts/openui.js';
import { UpstreamFailureError } from '../../errors/publicError.js';
import { createTestEnv } from '../createTestEnv.js';

const {
  MockApiConnectionError,
  MockApiConnectionTimeoutError,
  MockApiError,
  MockApiUserAbortError,
  promptLogWriteFailureMock,
  promptLogWriteMock,
  responsesCreateMock,
  responsesStreamMock,
} = vi.hoisted(() => {
  class HoistedMockApiError extends Error {
    constructor(message = 'Mock API error') {
      super(message);
      this.name = 'APIError';
    }
  }

  class HoistedMockApiConnectionError extends HoistedMockApiError {
    constructor(message = 'Mock API connection error') {
      super(message);
      this.name = 'APIConnectionError';
    }
  }

  class HoistedMockApiConnectionTimeoutError extends HoistedMockApiConnectionError {
    constructor(message = 'Mock API connection timeout error') {
      super(message);
      this.name = 'APIConnectionTimeoutError';
    }
  }

  class HoistedMockApiUserAbortError extends Error {
    constructor() {
      super('Request was aborted.');
      this.name = 'APIUserAbortError';
    }
  }

  return {
    MockApiConnectionError: HoistedMockApiConnectionError,
    MockApiConnectionTimeoutError: HoistedMockApiConnectionTimeoutError,
    MockApiError: HoistedMockApiError,
    MockApiUserAbortError: HoistedMockApiUserAbortError,
    promptLogWriteFailureMock: vi.fn(),
    promptLogWriteMock: vi.fn(),
    responsesCreateMock: vi.fn(),
    responsesStreamMock: vi.fn(),
  };
});

vi.mock(import('../../services/promptLog.js'), () => ({
  promptLog: {
    write: promptLogWriteMock,
    writeFailure: promptLogWriteFailureMock,
  },
}));

vi.mock('openai', () => {
  class MockOpenAI {
    responses = {
      create: responsesCreateMock,
      stream: responsesStreamMock,
    };

    constructor(_options?: unknown) {}
  }

  return {
    APIConnectionError: MockApiConnectionError,
    APIConnectionTimeoutError: MockApiConnectionTimeoutError,
    APIError: MockApiError,
    APIUserAbortError: MockApiUserAbortError,
    default: MockOpenAI,
  };
});

import { generateOpenUiSource, parseOpenUiGenerationEnvelope, streamOpenUiSource } from '../../services/openai.js';

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
            required: ['summary', 'source', 'notes'],
            properties: {
              summary: {
                type: 'string',
                maxLength: 200,
              },
              source: {
                type: 'string',
              },
              notes: {
                type: 'array',
                maxItems: 5,
                items: {
                  type: 'string',
                  maxLength: 200,
                },
              },
            },
          },
        },
      },
    }),
  );
}

describe('parseOpenUiGenerationEnvelope', () => {
  it('accepts the structured model envelope shape with required summary and notes', () => {
    expect(
      parseOpenUiGenerationEnvelope(
        JSON.stringify({
          notes: ['Uses one screen only.', 'Keeps local state minimal.'],
          source: 'root = AppShell([])',
          summary: 'Builds a simple one-screen app.',
        }),
      ),
    ).toEqual({
      notes: ['Uses one screen only.', 'Keeps local state minimal.'],
      source: 'root = AppShell([])',
      summary: 'Builds a simple one-screen app.',
    });
  });

  it('normalizes the plain-text model shape with empty summary and notes defaults', () => {
    expect(
      parseOpenUiGenerationEnvelope('```openui\nroot = AppShell([])\n```', {
        structuredOutput: false,
      }),
    ).toEqual({
      notes: [],
      source: 'root = AppShell([])',
      summary: '',
    });
  });

  it('rejects the structured model envelope shape when summary or notes are omitted', () => {
    expect(() =>
      parseOpenUiGenerationEnvelope(
        JSON.stringify({
          source: 'root = AppShell([])',
          summary: 'Builds a simple one-screen app.',
        }),
      ),
    ).toThrow(UpstreamFailureError);

    expect(() =>
      parseOpenUiGenerationEnvelope(
        JSON.stringify({
          notes: [],
          source: 'root = AppShell([])',
        }),
      ),
    ).toThrow(UpstreamFailureError);
  });
});

describe('generateOpenUiSource', () => {
  afterEach(() => {
    promptLogWriteFailureMock.mockReset();
    promptLogWriteMock.mockReset();
    responsesCreateMock.mockReset();
    responsesStreamMock.mockReset();
  });

  it('extracts source from a structured non-stream response', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-1',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        notes: [],
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
      notes: [],
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(responsesCreateMock).toHaveBeenCalledTimes(1);
    expectStructuredOutputRequest(responsesCreateMock.mock.calls[0]?.[0]);
  });

  it('uses lower temperature for repair requests while keeping explicit output limits', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-repair',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        notes: [],
        summary: 'Repairs the OpenUI document.',
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, repairRequest)).resolves.toEqual({
      notes: [],
      summary: 'Repairs the OpenUI document.',
      source: 'root = AppShell([])',
    });

    expect(responsesCreateMock).toHaveBeenCalledTimes(1);
    expectStructuredOutputRequest(responsesCreateMock.mock.calls[0]?.[0], { temperature: 0.2 });
    expect(responsesCreateMock.mock.calls[0]?.[0]).not.toHaveProperty('seed');
  });

  it('keeps the same cached system prefix and prompt cache key across initial and repair requests', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-cache',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        notes: [],
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
      notes: [],
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });
    await expect(generateOpenUiSource(env, repairRequest)).resolves.toEqual({
      notes: [],
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(responsesCreateMock).toHaveBeenCalledTimes(2);

    const initialCall = responsesCreateMock.mock.calls[0]?.[0];
    const repairCall = responsesCreateMock.mock.calls[1]?.[0];
    const initialSystemPrompt = initialCall?.input?.[0]?.content?.[0]?.text;
    const repairSystemPrompt = repairCall?.input?.[0]?.content?.[0]?.text;

    expect(initialSystemPrompt).toBe(repairSystemPrompt);
    expect(initialCall?.prompt_cache_key).toBe(repairCall?.prompt_cache_key);
    expect(initialCall?.temperature).toBe(0.6);
    expect(repairCall?.temperature).toBe(0.2);
  });

  it('logs cached token usage from non-stream Responses API usage details', async () => {
    const env = createTestEnv({
      LOG_LEVEL: 'info',
      OPENAI_API_KEY: 'test-key-usage-log',
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    responsesCreateMock.mockResolvedValue({
      _request_id: 'req_usage_log',
      output_text: JSON.stringify({
        notes: [],
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
      }),
      usage: {
        input_tokens: 1800,
        input_tokens_details: {
          cached_tokens: 1536,
        },
        output_tokens: 42,
        output_tokens_details: {
          reasoning_tokens: 0,
        },
        total_tokens: 1842,
      },
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
      notes: [],
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[openai.responses.create] request_id=req_usage_log input_tokens=1800 cached_tokens=1536 output_tokens=42 total_tokens=1842',
    );
  });

  it('writes prompt I/O logs for completed non-stream responses', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-prompt-log',
      PROMPT_IO_LOG: true,
    });
    const usage = {
      input_tokens: 18,
      output_tokens: 4,
      total_tokens: 22,
    };
    promptLogWriteMock.mockResolvedValue(undefined);
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        notes: [],
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
      }),
      usage,
    });

    await expect(generateOpenUiSource(env, request, undefined, 'builder-request-1')).resolves.toEqual({
      notes: [],
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(promptLogWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'builder-request-1',
        mode: 'initial',
        userPrompt: expect.stringContaining('Build a todo app'),
        currentSourceLen: 0,
        chatHistoryLen: 0,
        systemPromptHash: expect.any(String),
        modelOutputRaw: '{"notes":[],"summary":"Builds a blank app shell.","source":"root = AppShell([])"}',
        parsedEnvelope: {
          notes: [],
          summary: 'Builds a blank app shell.',
          source: 'root = AppShell([])',
        },
        usage,
        durationMs: expect.any(Number),
      }),
      {
        enabled: true,
      },
    );
  });

  it('writes parse failure prompt logs with parent request linkage and repair validation issue codes', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-parse-failure-log',
      PROMPT_IO_LOG: true,
    });
    const repairRequestWithContext: PromptBuildRequest = {
      ...repairRequest,
      parentRequestId: 'builder-request-parent',
      validationIssues: ['unresolved-reference', 'quality-missing-todo-controls'],
    };

    promptLogWriteFailureMock.mockResolvedValue(undefined);
    responsesCreateMock.mockResolvedValue({
      output_text: 'not-json',
      usage: {
        input_tokens: 10,
      },
    });

    await expect(generateOpenUiSource(env, repairRequestWithContext, undefined, 'builder-request-repair')).rejects.toBeInstanceOf(
      UpstreamFailureError,
    );

    expect(promptLogWriteFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'builder-request-repair',
        parentRequestId: 'builder-request-parent',
        mode: 'repair',
        modelOutputRaw: 'not-json',
        parsedEnvelope: null,
        validationIssues: ['unresolved-reference', 'quality-missing-todo-controls'],
        errorCode: 'upstream_error',
        errorMessage: 'The model returned malformed structured output.',
        phase: 'parse',
      }),
      {
        enabled: true,
      },
    );
  });

  it('writes request-phase failure prompt logs for timed out non-stream responses', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-request-failure-log',
      PROMPT_IO_LOG: true,
    });
    const timeoutError = new Error('The model request timed out.');

    timeoutError.name = 'TimeoutError';
    promptLogWriteFailureMock.mockResolvedValue(undefined);
    responsesCreateMock.mockRejectedValue(timeoutError);

    await expect(generateOpenUiSource(env, request, undefined, 'builder-request-timeout')).rejects.toBe(timeoutError);

    expect(promptLogWriteFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'builder-request-timeout',
        phase: 'request',
        errorCode: 'timeout_error',
        errorMessage: 'The model request timed out.',
        modelOutputRaw: '',
      }),
      {
        enabled: true,
      },
    );
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
        notes: [],
        summary: 'Builds a blank app shell.',
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
        notes: [],
        summary: 'Builds a blank app shell.',
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
        notes: [],
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
        extra: true,
      }),
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('accepts required summary and notes fields in structured envelopes', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-envelope-extra-fields',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        notes: ['Uses one screen only.', 'Keeps local state minimal.'],
        source: 'root = AppShell([])',
        summary: 'Builds a simple one-screen app.',
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
      notes: ['Uses one screen only.', 'Keeps local state minimal.'],
      source: 'root = AppShell([])',
      summary: 'Builds a simple one-screen app.',
    });
  });

  it('rejects raw structured responses above the raw envelope limit', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-6',
      LLM_OUTPUT_MAX_BYTES: 10,
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        notes: [],
        source: '1234567890',
        summary: '',
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
        notes: [],
        source: 'x'.repeat(51),
        summary: '',
      }),
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('normalizes the plain-text path to empty summary and notes defaults when structured output is disabled', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-8',
      LLM_STRUCTURED_OUTPUT: false,
    });
    responsesCreateMock.mockResolvedValue({
      output_text: '```openui\nroot = AppShell([])\n```',
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
      notes: [],
      source: 'root = AppShell([])',
      summary: '',
    });

    expect(responsesCreateMock).toHaveBeenCalledTimes(1);
    expect(responsesCreateMock.mock.calls[0]?.[0]).not.toHaveProperty('text');
  });
});

describe('streamOpenUiSource', () => {
  afterEach(() => {
    promptLogWriteFailureMock.mockReset();
    promptLogWriteMock.mockReset();
    responsesCreateMock.mockReset();
    responsesStreamMock.mockReset();
  });

  it('stops before processing a subsequent event after abort is observed', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-9',
    });
    const abortController = new AbortController();
    const onTextDelta = vi.fn((delta: string) => {
      if (delta === '{"summary":"Builds a blank app shell.","source":"root = ') {
        abortController.abort();
      }
    });
    const stream = createMockResponseStream(
      [
        { type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":"root = ' },
        { type: 'response.output_text.delta', delta: 'AppShell([])","notes":[]}' },
      ],
      { output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[]}' },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta, abortController.signal)).rejects.toBeInstanceOf(
      MockApiUserAbortError,
    );

    expect(onTextDelta).toHaveBeenCalledTimes(1);
    expect(onTextDelta).toHaveBeenCalledWith('{"summary":"Builds a blank app shell.","source":"root = ');
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
        return '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[]}';
      },
    };
    const stream = createMockResponseStream([abortingEvent], {
      output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[]}',
    });

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
        { type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":"root = ' },
        { type: 'response.output_text.delta', delta: 'AppShell([])","notes":[]}' },
      ],
      { output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[]}' },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).resolves.toEqual({
      notes: [],
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(onTextDelta).toHaveBeenNthCalledWith(1, '{"summary":"Builds a blank app shell.","source":"root = ');
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'AppShell([])","notes":[]}');
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
    const stream = createMockResponseStream([{ type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":' }], {
      output_text: '{"summary":"Builds a blank app shell.","source":',
    });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('rejects empty structured streamed output envelopes', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-14',
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream(
      [{ type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":"","notes":[]}' }],
      {
        output_text: '{"summary":"Builds a blank app shell.","source":"","notes":[]}',
      },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('rejects structured streamed output envelopes with extra properties', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-15',
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream(
      [{ type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[],"extra":true}' }],
      {
        output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[],"extra":true}',
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
    const stream = createMockResponseStream([{ type: 'response.output_text.delta', delta: '{"summary":"","source":"1234567890","notes":[]}' }], {
      output_text: '{"summary":"","source":"1234567890","notes":[]}',
    });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).rejects.toBeInstanceOf(UpstreamFailureError);

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(stream.abort).toHaveBeenCalledTimes(1);
    expect(stream.finalResponse).not.toHaveBeenCalled();
  });

  it('normalizes the plain-text streaming path to empty summary and notes defaults when structured output is disabled', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-17',
      LLM_STRUCTURED_OUTPUT: false,
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream(
      [{ type: 'response.output_text.delta', delta: '```openui\nroot = AppShell([])\n```' }],
      {
        output_text: '```openui\nroot = AppShell([])\n```',
      },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).resolves.toEqual({
      notes: [],
      source: 'root = AppShell([])',
      summary: '',
    });

    expect(onTextDelta).toHaveBeenCalledWith('```openui\nroot = AppShell([])\n```');
    expect(responsesStreamMock.mock.calls[0]?.[0]).not.toHaveProperty('text');
  });

  it('logs cached token usage from streamed Responses API usage details', async () => {
    const env = createTestEnv({
      LOG_LEVEL: 'info',
      OPENAI_API_KEY: 'test-key-stream-usage',
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const onTextDelta = vi.fn();
    const streamEvents = [
      {
        type: 'response.output_text.delta' as const,
        delta: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[]}',
      },
    ];
    const finalResponse = {
      _request_id: 'req_stream_usage',
      output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[]}',
      usage: {
        input_tokens: 2000,
        input_tokens_details: {
          cached_tokens: 1600,
        },
        output_tokens: 25,
        output_tokens_details: {
          reasoning_tokens: 0,
        },
        total_tokens: 2025,
      },
    };
    const stream = createMockResponseStream(streamEvents, finalResponse);

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).resolves.toEqual({
      notes: [],
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[openai.responses.stream] request_id=req_stream_usage input_tokens=2000 cached_tokens=1600 output_tokens=25 total_tokens=2025',
    );
  });

  it('writes prompt I/O logs after a finalized stream response', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-stream-prompt-log',
      PROMPT_IO_LOG: true,
    });
    const usage = {
      input_tokens: 20,
      output_tokens: 5,
      total_tokens: 25,
    };
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream(
      [{ type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[]}' }],
      {
        output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[]}',
        usage,
      },
    );
    promptLogWriteMock.mockResolvedValue(undefined);
    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta, undefined, 'builder-request-stream')).resolves.toEqual({
      notes: [],
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(promptLogWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'builder-request-stream',
        modelOutputRaw: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[]}',
        parsedEnvelope: {
          notes: [],
          summary: 'Builds a blank app shell.',
          source: 'root = AppShell([])',
        },
        usage,
      }),
      {
        enabled: true,
      },
    );
  });

  it('writes stream failure prompt logs when finalizing the stream fails', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-stream-failure-log',
      PROMPT_IO_LOG: true,
    });
    const streamTimeoutError = new Error('The model request timed out.');

    streamTimeoutError.name = 'TimeoutError';
    promptLogWriteFailureMock.mockResolvedValue(undefined);
    responsesStreamMock.mockReturnValue({
      abort: vi.fn(),
      finalResponse: vi.fn().mockRejectedValue(streamTimeoutError),
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'response.output_text.delta' as const,
          delta: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[]}',
        };
      },
    });

    await expect(streamOpenUiSource(env, request, vi.fn(), undefined, 'builder-request-stream-failure')).rejects.toBe(
      streamTimeoutError,
    );

    expect(promptLogWriteFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'builder-request-stream-failure',
        phase: 'stream',
        errorCode: 'timeout_error',
        errorMessage: 'The model request timed out.',
        modelOutputRaw: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","notes":[]}',
      }),
      {
        enabled: true,
      },
    );
  });
});
