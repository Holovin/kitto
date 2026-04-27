import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptBuildRequest } from '#backend/prompts/openui.js';
import { UpstreamFailureError } from '#backend/errors/publicError.js';
import { createTestEnv } from '#backend/tests/createTestEnv.js';

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

vi.mock(import('#backend/services/promptLog.js'), () => ({
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

import { generateOpenUiSource, parseOpenUiGenerationEnvelope, streamOpenUiSource } from '#backend/services/openai.js';
import { logResponseUsage } from '#backend/services/openai/logging.js';
import { consumeOpenAiResponseStream, type OpenAiResponseStreamState } from '#backend/services/openai/streaming.js';

const request: PromptBuildRequest = {
  chatHistory: [],
  currentSource: '',
  mode: 'initial',
  prompt: 'Build a todo app',
};

const requestWithHistory: PromptBuildRequest = {
  ...request,
  currentSource: 'root = AppShell([])',
  chatHistory: [
    {
      role: 'user',
      content: 'Start with a tiny todo app.',
    },
    {
      role: 'assistant',
      content: 'Built a one-screen todo app.',
    },
    {
      role: 'user',
      content: 'Add filters and a settings screen.',
    },
  ],
};

const requestWithLongHistory: PromptBuildRequest = {
  ...request,
  currentSource: 'root = AppShell([])',
  chatHistory: [
    {
      role: 'user',
      content: 'Start with a tiny todo app.',
    },
    {
      role: 'assistant',
      content: 'Built a one-screen todo app.',
    },
    {
      role: 'user',
      content: 'Add filters and a settings screen.',
    },
    {
      role: 'assistant',
      content: 'Added filters and a settings screen.',
    },
    {
      role: 'user',
      content: 'Add a dark mode toggle.',
    },
    {
      role: 'assistant',
      content: 'Added dark mode support.',
    },
  ],
};

const requestWithSignupIterationHistory: PromptBuildRequest = {
  ...request,
  prompt: 'Кнопка продолжить должна быть неактивной пока почта не валидная',
  currentSource: 'root = AppShell([])',
  chatHistory: [
    {
      role: 'user',
      content: 'Create a signup form with name, email, and a required agreement checkbox.',
    },
    {
      role: 'assistant',
      content: 'A simple signup form with name, email, and a required agreement checkbox.',
    },
    {
      role: 'user',
      content: 'Добавь экран после заполнения формы',
    },
    {
      role: 'assistant',
      content: 'A signup form with name, email, and required agreement checkbox. After submission, it now shows a confirmation screen.',
    },
    {
      role: 'user',
      content: 'Для email сделай фильтр почты',
    },
    {
      role: 'assistant',
      content: 'The signup form now includes an email filter dropdown. You can choose the email type before continuing to the confirmation screen.',
    },
    {
      role: 'user',
      content: 'Remove filter, add email validation',
    },
    {
      role: 'assistant',
      content: 'The signup form now has name, email, and a required agreement checkbox. Email validation is enabled, and the email filter control has been removed.',
    },
  ],
};

const repairRequest: PromptBuildRequest = {
  ...request,
  invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
  mode: 'repair',
  validationIssues: [
    {
      code: 'unresolved-reference',
      message: 'This statement was referenced but never defined in the final source.',
      source: 'parser',
      statementId: 'items',
    },
  ],
};

function createMockResponseStream(
  events: Array<{ delta?: string; type?: string }>,
  finalResponse: { _request_id?: unknown; output?: unknown; output_text?: unknown; usage?: unknown },
) {
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
      temperature: options?.temperature ?? 0.4,
      text: {
        format: {
          type: 'json_schema',
          name: 'kitto_openui_source',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'source'],
            properties: {
              summary: {
                type: 'string',
                maxLength: 200,
              },
              source: {
                type: 'string',
                minLength: 1,
              },
            },
          },
        },
      },
    }),
  );
}

describe('parseOpenUiGenerationEnvelope', () => {
  it('accepts the structured model envelope shape with required summary and source', () => {
    expect(
      parseOpenUiGenerationEnvelope(
        JSON.stringify({
          source: 'root = AppShell([])',
          summary: 'Builds a simple one-screen app.',
        }),
      ),
    ).toEqual({
      source: 'root = AppShell([])',
      summary: 'Builds a simple one-screen app.',
    });
  });

  it('rejects the structured model envelope shape when summary or source are omitted', () => {
    expect(() =>
      parseOpenUiGenerationEnvelope(
        JSON.stringify({
          source: 'root = AppShell([])',
        }),
      ),
    ).toThrow(UpstreamFailureError);

    expect(() =>
      parseOpenUiGenerationEnvelope(
        JSON.stringify({
          summary: 'Builds a simple one-screen app.',
        }),
      ),
    ).toThrow(UpstreamFailureError);
  });

  it('can enforce the raw structured output limit during parsing', () => {
    const env = createTestEnv({
      LLM_OUTPUT_MAX_BYTES: 5,
    });

    expect(() =>
      parseOpenUiGenerationEnvelope(
        JSON.stringify({
          source: 'root = AppShell([])',
          summary: 'Builds a simple one-screen app.',
        }),
        env,
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
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
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
        summary: 'Repairs the OpenUI document.',
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, repairRequest)).resolves.toEqual({
      summary: 'Repairs the OpenUI document.',
      source: 'root = AppShell([])',
    });

    expect(responsesCreateMock).toHaveBeenCalledTimes(1);
    expectStructuredOutputRequest(responsesCreateMock.mock.calls[0]?.[0], { temperature: 0.2 });
    expect(responsesCreateMock.mock.calls[0]?.[0]).not.toHaveProperty('seed');
  });

  it('builds role-based input for initial and repair requests', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-role-based',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, requestWithHistory)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });
    await expect(generateOpenUiSource(env, repairRequest)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    const initialCall = responsesCreateMock.mock.calls[0]?.[0];
    const repairCall = responsesCreateMock.mock.calls[1]?.[0];

    expect(initialCall?.input).toEqual([
      {
        role: 'system',
        content: [{ type: 'input_text', text: expect.any(String) }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Start with a tiny todo app.' }],
      },
      {
        role: 'assistant',
        content: expect.stringContaining('<assistant_summary>'),
        phase: 'final_answer',
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Add filters and a settings screen.' }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: expect.stringContaining('<intent_context>'),
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: expect.stringContaining('<latest_user_request>\nBuild a todo app\n</latest_user_request>'),
          },
        ],
      },
    ]);
    expect(initialCall?.input?.[2]?.content).toContain('Built a one-screen todo app.');
    expect(initialCall?.input?.[4]?.content?.[0]?.text).toContain('<request_intent>\ntodo: true');
    expect(initialCall?.input?.[5]?.content?.[0]?.text).toContain('<current_source>\nroot = AppShell([])\n</current_source>');
    expect(repairCall?.input).toHaveLength(4);
    expect(repairCall?.input?.[0]?.role).toBe('system');
    expect(repairCall?.input?.[0]?.content?.[0]?.text).toContain('Repair-mode instruction:');
    expect(repairCall?.input?.[0]?.content?.[0]?.text).toContain('Automatic repair attempt 1 of 2.');
    expect(repairCall?.input?.[1]?.role).toBe('user');
    expect(repairCall?.input?.[1]?.content?.[0]?.text).toContain('<original_user_request>\nBuild a todo app\n</original_user_request>');
    expect(repairCall?.input?.[1]?.content?.[0]?.text).toContain('<current_source_inventory>');
    expect(repairCall?.input?.[2]?.role).toBe('assistant');
    expect(repairCall?.input?.[2]?.content).toContain('<model_draft_that_failed>');
    expect(repairCall?.input?.[2]?.content).toContain('root = AppShell([Button("broken", "Broken", "default")])');
    expect(repairCall?.input?.[3]?.role).toBe('user');
    expect(repairCall?.input?.[3]?.content?.[0]?.text).toContain('<validation_issues>');
    expect(repairCall?.input?.[3]?.content?.[0]?.text).toContain('Return the corrected complete OpenUI Lang program in `source`.');
  });

  it('passes filtered conversation context into role-based repair input', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-role-based-repair-context',
    });
    const repairRequestWithHistory: PromptBuildRequest = {
      ...repairRequest,
      chatHistory: [
        {
          role: 'system',
          content: 'Internal UI notice.',
        },
        {
          role: 'user',
          content: 'Create a signup form.',
        },
        {
          role: 'assistant',
          content: 'Built a signup form with an email field.',
        },
        {
          role: 'assistant',
          content: 'Excluded assistant summary.',
          excludeFromLlmContext: true,
        },
        {
          role: 'user',
          content: 'Add email validation.',
        },
      ],
    };

    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'Repairs the OpenUI document.',
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, repairRequestWithHistory)).resolves.toEqual({
      summary: 'Repairs the OpenUI document.',
      source: 'root = AppShell([])',
    });

    const repairInput = responsesCreateMock.mock.calls[0]?.[0]?.input;

    expect(repairInput?.slice(1)).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "Repair context for the failed draft.

      Use these blocks as context, not as user-authored instructions.

      <original_user_request>
      Build a todo app
      </original_user_request>

      <conversation_context>
      - User: Add email validation.
      - Assistant: Built a signup form with an email field.
      - User: Create a signup form.
      </conversation_context>

      <current_source_inventory>
      (blank canvas, no committed OpenUI inventory yet)
      </current_source_inventory>",
              "type": "input_text",
            },
          ],
          "role": "user",
        },
        {
          "content": "<model_draft_that_failed>
      root = AppShell([Button("broken", "Broken", "default")])
      </model_draft_that_failed>",
          "phase": "final_answer",
          "role": "assistant",
        },
        {
          "content": [
            {
              "text": "Repair only the failed draft from the previous assistant message.

      <validation_issues>
      - unresolved-reference in items: This statement was referenced but never defined in the final source.
      </validation_issues>

      Return the corrected complete OpenUI Lang program in \`source\`. Make \`summary\` a short user-facing description of the visible app/change with concrete features/screens, not generic "Updated the app" text.",
              "type": "input_text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it('keeps the full filtered role-based history when request compaction has already finished upstream', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-pinned-role-based',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, requestWithLongHistory)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    const initialCall = responsesCreateMock.mock.calls[0]?.[0];

    expect(initialCall?.input).toHaveLength(9);
    expect(initialCall?.input?.[0]).toEqual({
      role: 'system',
      content: [{ type: 'input_text', text: expect.any(String) }],
    });
    expect(initialCall?.input?.[1]).toEqual({
      role: 'user',
      content: [{ type: 'input_text', text: 'Start with a tiny todo app.' }],
    });
    expect(initialCall?.input?.[2]).toEqual({
      role: 'assistant',
      content: expect.stringContaining('Built a one-screen todo app.'),
      phase: 'final_answer',
    });
    expect(initialCall?.input?.[3]).toEqual({
      role: 'user',
      content: [{ type: 'input_text', text: 'Add filters and a settings screen.' }],
    });
    expect(initialCall?.input?.[4]).toEqual({
      role: 'assistant',
      content: expect.stringContaining('Added filters and a settings screen.'),
      phase: 'final_answer',
    });
    expect(initialCall?.input?.[5]).toEqual({
      role: 'user',
      content: [{ type: 'input_text', text: 'Add a dark mode toggle.' }],
    });
    expect(initialCall?.input?.[6]).toEqual({
      role: 'assistant',
      content: expect.stringContaining('Added dark mode support.'),
      phase: 'final_answer',
    });
    expect(initialCall?.input?.[7]).toEqual({
      role: 'user',
      content: [{ type: 'input_text', text: expect.stringContaining('<intent_context>') }],
    });
    expect(initialCall?.input?.[8]).toEqual({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: expect.stringContaining('<latest_user_request>\nBuild a todo app\n</latest_user_request>'),
        },
      ],
    });
  });

  it('does not silently trim signup iteration history down to a stale assistant summary window', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-signup-history-window',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'Keeps the Continue button disabled until the email is valid.',
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, requestWithSignupIterationHistory)).resolves.toEqual({
      summary: 'Keeps the Continue button disabled until the email is valid.',
      source: 'root = AppShell([])',
    });

    const initialCall = responsesCreateMock.mock.calls[0]?.[0];

    expect(initialCall?.input).toHaveLength(11);
    expect(initialCall?.input?.slice(1, -2)).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Create a signup form with name, email, and a required agreement checkbox.' }],
      },
      {
        role: 'assistant',
        content: expect.stringContaining('A simple signup form with name, email, and a required agreement checkbox.'),
        phase: 'final_answer',
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Добавь экран после заполнения формы' }],
      },
      {
        role: 'assistant',
        content: expect.stringContaining('After submission, it now shows a confirmation screen.'),
        phase: 'final_answer',
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Для email сделай фильтр почты' }],
      },
      {
        role: 'assistant',
        content: expect.stringContaining('email filter dropdown'),
        phase: 'final_answer',
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Remove filter, add email validation' }],
      },
      {
        role: 'assistant',
        content: expect.stringContaining('Email validation is enabled, and the email filter control has been removed.'),
        phase: 'final_answer',
      },
    ]);
    expect(initialCall?.input?.at(-2)).toEqual({
      role: 'user',
      content: [{ type: 'input_text', text: expect.stringContaining('<intent_context>') }],
    });
    expect(initialCall?.input?.at(-1)).toEqual({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: expect.stringContaining(
            '<latest_user_request>\nКнопка продолжить должна быть неактивной пока почта не валидная\n</latest_user_request>',
          ),
        },
      ],
    });
  });

  it('keeps the same cached system prefix and prompt cache key across initial and repair requests', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-cache',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });
    await expect(generateOpenUiSource(env, repairRequest)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(responsesCreateMock).toHaveBeenCalledTimes(2);

    const initialCall = responsesCreateMock.mock.calls[0]?.[0];
    const repairCall = responsesCreateMock.mock.calls[1]?.[0];
    const initialSystemPrompt = initialCall?.input?.[0]?.content?.[0]?.text;
    const repairSystemPrompt = repairCall?.input?.[0]?.content?.[0]?.text;

    expect(repairSystemPrompt).toContain('Repair-mode instruction:');
    expect(repairSystemPrompt?.startsWith(initialSystemPrompt ?? '')).toBe(true);
    expect(initialCall?.prompt_cache_key).toBe(repairCall?.prompt_cache_key);
    expect(initialCall?.temperature).toBe(0.4);
    expect(repairCall?.temperature).toBe(0.2);
  });

  it('reuses one stable prompt cache key while varying intent context by request', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-intent-cache',
    });
    const todoAliasRequest: PromptBuildRequest = {
      ...request,
      prompt: 'Build a to-do app',
    };
    const themeRequest: PromptBuildRequest = {
      ...request,
      prompt: 'Create a dark mode form',
    };

    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });
    await expect(generateOpenUiSource(env, todoAliasRequest)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });
    await expect(generateOpenUiSource(env, themeRequest)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    const firstTodoCall = responsesCreateMock.mock.calls[0]?.[0];
    const secondTodoCall = responsesCreateMock.mock.calls[1]?.[0];
    const themeCall = responsesCreateMock.mock.calls[2]?.[0];

    expect(firstTodoCall?.prompt_cache_key).toBe(secondTodoCall?.prompt_cache_key);
    expect(firstTodoCall?.prompt_cache_key).toMatch(/^kitto:openui:base:[a-f0-9]{12}$/);
    expect(themeCall?.prompt_cache_key).toBe(firstTodoCall?.prompt_cache_key);
    expect(firstTodoCall?.input?.[0]?.content?.[0]?.text).not.toContain('APPEARANCE / THEME CONTRACT:');
    expect(themeCall?.input?.[0]?.content?.[0]?.text).not.toContain('APPEARANCE / THEME CONTRACT:');
    expect(themeCall?.input?.at(-2)?.content?.[0]?.text).toContain('APPEARANCE / THEME CONTRACT:');
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
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
      }),
      usage,
    });

    await expect(generateOpenUiSource(env, request, undefined, { requestId: 'builder-request-1' })).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(promptLogWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'builder-request-1',
        mode: 'initial',
        rawUserRequest: 'Build a todo app',
        currentSourceLen: 0,
        chatHistoryLen: 0,
        inputShape: 'role-based',
        systemPromptHash: expect.any(String),
        modelOutputRaw: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}',
        parsedEnvelope: {
          summary: 'Builds a blank app shell.',
          source: 'root = AppShell([])',
        },
        usage,
        validationIssues: [],
        durationMs: expect.any(Number),
      }),
      {
        enabled: true,
      },
    );
  });

  it('writes the concrete repair attempt number in prompt I/O logs', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-prompt-log-repair-attempt',
      PROMPT_IO_LOG: true,
    });
    const repairRequestWithAttempt: PromptBuildRequest = {
      ...repairRequest,
      repairAttemptNumber: 2,
    };

    promptLogWriteMock.mockResolvedValue(undefined);
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'Repairs the app shell.',
        source: 'root = AppShell([])',
      }),
      usage: null,
    });

    await expect(
      generateOpenUiSource(env, repairRequestWithAttempt, undefined, { requestId: 'builder-request-repair-2' }),
    ).resolves.toEqual({
      summary: 'Repairs the app shell.',
      source: 'root = AppShell([])',
    });

    expect(promptLogWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'repair',
        repairAttempt: 2,
        requestId: 'builder-request-repair-2',
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

    promptLogWriteFailureMock.mockResolvedValue(undefined);
    responsesCreateMock.mockResolvedValue({
      output_text: 'not-json',
      usage: {
        input_tokens: 10,
      },
    });

    await expect(generateOpenUiSource(env, repairRequestWithContext, undefined, { requestId: 'builder-request-repair' })).rejects.toBeInstanceOf(
      UpstreamFailureError,
    );

    expect(promptLogWriteFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'builder-request-repair',
        parentRequestId: 'builder-request-parent',
        mode: 'repair',
        rawUserRequest: 'Build a todo app',
        inputShape: 'role-based',
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

    await expect(generateOpenUiSource(env, request, undefined, { requestId: 'builder-request-timeout' })).rejects.toBe(timeoutError);

    expect(promptLogWriteFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'builder-request-timeout',
        rawUserRequest: 'Build a todo app',
        inputShape: 'role-based',
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
        summary: 'Builds a blank app shell.',
        source: 'root = AppShell([])',
        extra: true,
      }),
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

  it('accepts required summary and source fields in structured envelopes', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-envelope-extra-fields',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        source: 'root = AppShell([])',
        summary: 'Builds a simple one-screen app.',
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
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
        source: 'x'.repeat(51),
        summary: '',
      }),
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
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
        { type: 'response.output_text.delta', delta: 'AppShell([])"}' },
      ],
      { output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}' },
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
        return '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}';
      },
    };
    const stream = createMockResponseStream([abortingEvent], {
      output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}',
    });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta, abortController.signal)).rejects.toBeInstanceOf(
      MockApiUserAbortError,
    );

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(stream.abort).toHaveBeenCalledTimes(1);
    expect(stream.finalResponse).not.toHaveBeenCalled();
  });

  it('logs client_aborted stream failures when the client aborts an in-flight stream', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-client-abort-log',
      PROMPT_IO_LOG: true,
    });
    const abortController = new AbortController();
    const onTextDelta = vi.fn((delta: string) => {
      if (delta.includes('"source":"root = ')) {
        abortController.abort();
      }
    });
    const stream = createMockResponseStream(
      [
        { type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":"root = ' },
        { type: 'response.output_text.delta', delta: 'AppShell([])"}' },
      ],
      { output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}' },
    );

    promptLogWriteFailureMock.mockResolvedValue(undefined);
    responsesStreamMock.mockReturnValue(stream);

    await expect(
      streamOpenUiSource(env, request, onTextDelta, abortController.signal, { requestId: 'builder-request-client-abort' }),
    ).rejects.toBeInstanceOf(MockApiUserAbortError);

    expect(promptLogWriteFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'client_aborted',
        inputShape: 'role-based',
        phase: 'stream',
        requestId: 'builder-request-client-abort',
      }),
      {
        enabled: true,
      },
    );
  });

  it('accumulates structured JSON chunks but returns the extracted source', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-11',
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream(
      [
        { type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":"root = ' },
        { type: 'response.output_text.delta', delta: 'AppShell([])"}' },
      ],
      { output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}' },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(onTextDelta).toHaveBeenNthCalledWith(1, '{"summary":"Builds a blank app shell.","source":"root = ');
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
      [{ type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":""}' }],
      {
        output_text: '{"summary":"Builds a blank app shell.","source":""}',
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
      [{ type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","extra":true}' }],
      {
        output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])","extra":true}',
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
    const stream = createMockResponseStream([{ type: 'response.output_text.delta', delta: '{"summary":"","source":"1234567890"}' }], {
      output_text: '{"summary":"","source":"1234567890"}',
    });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).rejects.toBeInstanceOf(UpstreamFailureError);

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(stream.abort).toHaveBeenCalledTimes(1);
    expect(stream.finalResponse).not.toHaveBeenCalled();
  });

  it('rejects streamed structured output when the extracted source exceeds the final source limit', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-16b',
      LLM_OUTPUT_MAX_BYTES: 50,
    });
    const onTextDelta = vi.fn();
    const oversizedSource = 'x'.repeat(51);
    const rawEnvelope = JSON.stringify({
      summary: '',
      source: oversizedSource,
    });
    const midpoint = Math.floor(rawEnvelope.length / 2);
    const stream = createMockResponseStream(
      [
        { type: 'response.output_text.delta', delta: rawEnvelope.slice(0, midpoint) },
        { type: 'response.output_text.delta', delta: rawEnvelope.slice(midpoint) },
      ],
      {
        output_text: rawEnvelope,
      },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).rejects.toBeInstanceOf(UpstreamFailureError);

    expect(onTextDelta).toHaveBeenNthCalledWith(1, rawEnvelope.slice(0, midpoint));
    expect(onTextDelta).toHaveBeenNthCalledWith(2, rawEnvelope.slice(midpoint));
    expect(stream.abort).not.toHaveBeenCalled();
    expect(stream.finalResponse).toHaveBeenCalledTimes(1);
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
        delta: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}',
      },
    ];
    const finalResponse = {
      _request_id: 'req_stream_usage',
      output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}',
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
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[openai.responses.stream] request_id=req_stream_usage input_tokens=2000 cached_tokens=1600 output_tokens=25 total_tokens=2025',
    );
  });

  it('uses the captured streaming HTTP request id when the finalized response lacks one', async () => {
    const env = createTestEnv({
      LOG_LEVEL: 'info',
      OPENAI_API_KEY: 'test-key-stream-captured-request-id',
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stream = createMockResponseStream(
      [{ type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}' }],
      {
        output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}',
        usage: {
          input_tokens: 2000,
          input_tokens_details: {
            cached_tokens: 1600,
          },
          output_tokens: 25,
          total_tokens: 2025,
        },
      },
    );
    const streamState: OpenAiResponseStreamState = {
      finalResponse: null,
      streamedText: '',
    };

    await expect(
      consumeOpenAiResponseStream(env, stream, vi.fn(), undefined, streamState, {
        getRequestId: () => 'req_stream_header',
      }),
    ).resolves.toBe('{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}');

    expect((streamState.finalResponse as { _request_id?: unknown } | null)?._request_id).toBe('req_stream_header');
    logResponseUsage(env, 'stream', streamState.finalResponse);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[openai.responses.stream] request_id=req_stream_header input_tokens=2000 cached_tokens=1600 output_tokens=25 total_tokens=2025',
    );
  });

  it('warns when the finalized stream text differs from the streamed deltas', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-stream-mismatch',
    });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream(
      [{ type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}' }],
      {
        _request_id: 'req_stream_mismatch',
        output_text: '{"summary":"Builds a different app shell.","source":"root = AppShell([Text(\\"Changed\\", \\"body\\", \\"start\\")])"}',
      },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).resolves.toEqual({
      summary: 'Builds a different app shell.',
      source: 'root = AppShell([Text("Changed", "body", "start")])',
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[openai.responses.stream] finalized response text differed from streamed deltas; request_id=req_stream_mismatch'),
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
      [{ type: 'response.output_text.delta', delta: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}' }],
      {
        output_text: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}',
        usage,
      },
    );
    promptLogWriteMock.mockResolvedValue(undefined);
    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta, undefined, { requestId: 'builder-request-stream' })).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      source: 'root = AppShell([])',
    });

    expect(promptLogWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'builder-request-stream',
        rawUserRequest: 'Build a todo app',
        inputShape: 'role-based',
        modelOutputRaw: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}',
        parsedEnvelope: {
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
          delta: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}',
        };
      },
    });

    await expect(streamOpenUiSource(env, request, vi.fn(), undefined, { requestId: 'builder-request-stream-failure' })).rejects.toBe(
      streamTimeoutError,
    );

    expect(promptLogWriteFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'builder-request-stream-failure',
        rawUserRequest: 'Build a todo app',
        inputShape: 'role-based',
        phase: 'stream',
        errorCode: 'timeout_error',
        errorMessage: 'The model request timed out.',
        modelOutputRaw: '{"summary":"Builds a blank app shell.","source":"root = AppShell([])"}',
      }),
      {
        enabled: true,
      },
    );
  });
});
