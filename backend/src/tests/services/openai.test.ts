import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_MEMORY_MAX_CHARS, CURRENT_SOURCE_TOO_LARGE_PUBLIC_MESSAGE } from '@kitto-openui/shared/builderApiContract.js';
import {
  detectPromptRequestIntent,
  getOpenUiSystemPromptHash,
  type PromptBuildRequest,
} from '#backend/prompts/openui.js';
import { UpstreamFailureError } from '#backend/errors/publicError.js';
import { createTestEnv } from '#backend/tests/createTestEnv.js';

const {
  MockApiConnectionError,
  MockApiConnectionTimeoutError,
  MockApiError,
  MockApiUserAbortError,
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
    promptLogWriteMock: vi.fn(),
    responsesCreateMock: vi.fn(),
    responsesStreamMock: vi.fn(),
  };
});

vi.mock(import('#backend/services/promptLog.js'), () => ({
  promptLog: {
    write: promptLogWriteMock,
  },
}));

vi.mock('openai', () => {
  class MockOpenAI {
    responses = {
      create: responsesCreateMock,
      stream: responsesStreamMock,
    };

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
  currentSource: '',
  mode: 'initial',
  prompt: 'Build a todo app',
};

const requestWithHistory: PromptBuildRequest = {
  ...request,
  currentSource: 'root = AppShell([])',
  previousUserMessages: ['Start with a tiny todo app.', 'Add filters and a settings screen.'],
  previousChangeSummaries: ['Built a one-screen todo app.'],
};

const requestWithLongHistory: PromptBuildRequest = {
  ...request,
  currentSource: 'root = AppShell([])',
  previousUserMessages: ['Start with a tiny todo app.', 'Add filters and a settings screen.', 'Add a dark mode toggle.'],
  previousChangeSummaries: [
    'Built a one-screen todo app.',
    'Added filters and a settings screen.',
    'Added dark mode support.',
  ],
};

const requestWithSignupIterationHistory: PromptBuildRequest = {
  ...request,
  prompt: 'Кнопка продолжить должна быть неактивной пока почта не валидная',
  currentSource: 'root = AppShell([])',
  previousUserMessages: [
    'Create a signup form with name, email, and a required agreement checkbox.',
    'Добавь экран после заполнения формы',
    'Для email сделай фильтр почты',
    'Remove filter, add email validation',
  ],
  previousChangeSummaries: [
    'A simple signup form with name, email, and a required agreement checkbox.',
    'A signup form with name, email, and required agreement checkbox. After submission, it now shows a confirmation screen.',
    'The signup form now includes an email filter dropdown. You can choose the email type before continuing to the confirmation screen.',
    'The signup form now has name, email, and a required agreement checkbox. Email validation is enabled, and the email filter control has been removed.',
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
const testAppMemory = {
  version: 1 as const,
  appSummary: 'Test app',
  userPreferences: ['Keep the test UI compact.'],
  avoid: [] as string[],
};

function createEnvelopeText(summary: string, source: string) {
  return JSON.stringify({
    summary,
    changeSummary: 'Test generation change.',
    appMemory: testAppMemory,
    source,
  });
}

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
            required: ['summary', 'changeSummary', 'source', 'appMemory'],
            properties: {
              summary: {
                type: 'string',
                maxLength: 200,
              },
              changeSummary: {
                type: 'string',
                maxLength: 300,
              },
              source: {
                type: 'string',
                minLength: 1,
              },
              appMemory: {
                type: 'object',
                additionalProperties: false,
                required: ['version', 'appSummary', 'userPreferences', 'avoid'],
                properties: {
                  version: {
                    type: 'number',
                    const: 1,
                  },
                  appSummary: {
                    type: 'string',
                    maxLength: 1800,
                  },
                  userPreferences: {
                    type: 'array',
                    maxItems: 8,
                    items: { type: 'string', maxLength: 180 },
                  },
                  avoid: {
                    type: 'array',
                    maxItems: 8,
                    items: { type: 'string', maxLength: 180 },
                  },
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
  it('accepts the structured model envelope shape with required summary and source', () => {
    expect(
      parseOpenUiGenerationEnvelope(
        JSON.stringify({
          source: 'root = AppShell([])',
          summary: 'Builds a simple one-screen app.',
          changeSummary: 'Test generation change.',
          appMemory: testAppMemory,
        }),
      ),
    ).toEqual({
      source: 'root = AppShell([])',
      summary: 'Builds a simple one-screen app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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
          changeSummary: 'Test generation change.',
          appMemory: testAppMemory,
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
          changeSummary: 'Test generation change.',
          appMemory: testAppMemory,
        }),
        env,
      ),
    ).toThrow(UpstreamFailureError);
  });

  it('normalizes appMemory strings and keeps serialized memory under the app memory limit', () => {
    const longText = 'x'.repeat(180);
    const parsedEnvelope = parseOpenUiGenerationEnvelope(
      JSON.stringify({
        source: 'root = AppShell([])',
        summary: 'Builds a simple one-screen app.',
        changeSummary: 'Test generation change.',
        appMemory: {
          version: 1,
          appSummary: `  ${'A'.repeat(1800)}  `,
          userPreferences: [' Keep the UI compact. ', '', 'Keep the UI compact.', ...Array.from({ length: 5 }, () => longText)],
          avoid: Array.from({ length: 8 }, () => longText),
        },
      }),
    );

    expect(parsedEnvelope.appMemory.version).toBe(1);
    expect(parsedEnvelope.appMemory.appSummary).toBe('A'.repeat(1800));
    expect(parsedEnvelope.appMemory.userPreferences[0]).toBe('Keep the UI compact.');
    expect(parsedEnvelope.appMemory.userPreferences).toEqual([...new Set(parsedEnvelope.appMemory.userPreferences)]);
    expect(parsedEnvelope.appMemory.userPreferences).not.toContain('');
    expect(JSON.stringify(parsedEnvelope.appMemory).length).toBeLessThanOrEqual(APP_MEMORY_MAX_CHARS);
  });
});

describe('generateOpenUiSource', () => {
  afterEach(() => {
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, repairRequest)).resolves.toEqual({
      summary: 'Repairs the OpenUI document.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, requestWithHistory)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      source: 'root = AppShell([])',
    });
    await expect(generateOpenUiSource(env, repairRequest)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      source: 'root = AppShell([])',
    });

    const initialCall = responsesCreateMock.mock.calls[0]?.[0];
    const repairCall = responsesCreateMock.mock.calls[1]?.[0];

    expect(initialCall?.input).toHaveLength(3);
    expect(initialCall?.input?.[0]).toEqual({
      role: 'system',
      content: [{ type: 'input_text', text: expect.any(String) }],
    });
    expect(initialCall?.input?.[1]).toEqual({
      role: 'user',
      content: [{ type: 'input_text', text: expect.stringContaining('<intent_context>') }],
    });
    const initialIntentContextText = initialCall?.input?.[1]?.content?.[0]?.text ?? '';
    const initialFinalUserText = initialCall?.input?.at(-1)?.content?.[0]?.text ?? '';

    expect(initialIntentContextText).toContain('<intent_context>');
    expect(initialIntentContextText).toContain(
      '<request_intent>\nThis request appears to be: a fresh create request, single-screen app, simple scope, todo/list behavior, no explicit validation rules, no explicit theme switching.\n</request_intent>',
    );
    expect(initialFinalUserText).toContain('<current_source>\nroot = AppShell([])\n</current_source>');
    expect(initialFinalUserText).toContain('<previous_user_messages>\n["Start with a tiny todo app.","Add filters and a settings screen."]\n</previous_user_messages>');
    expect(initialFinalUserText).toContain('<previous_change_summaries>\n["Built a one-screen todo app."]\n</previous_change_summaries>');
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

  it('protects full current source in follow-up prompts and records source-context metadata', async () => {
    const env = createTestEnv({
      LLM_MODEL_PROMPT_MAX_CHARS: 1_200,
      OPENAI_API_KEY: 'test-key-protected-current-source',
      PROMPT_IO_LOG: true,
    });
    const currentSource = `${'x'.repeat(2_500)}\nEND-OF-CURRENT-SOURCE`;
    const protectedRequest: PromptBuildRequest = {
      appMemory: {
        version: 1,
        appSummary: 'A compact app summary that can be dropped before current source.',
        userPreferences: ['Keep the layout compact.'],
        avoid: ['Do not add charts.'],
      },
      chatHistory: [
        { role: 'user', content: 'Create the first version.' },
        { role: 'assistant', content: 'Added the first version.' },
        { role: 'assistant', content: '<history_summary>\nUser: create first version\nAssistant: added shell\n</history_summary>' },
        { role: 'user', content: 'Add a settings screen.' },
      ],
      currentSource,
      mode: 'initial',
      previousSource: 'root = AppShell([])',
      prompt: 'Add a delete button.',
    };
    promptLogWriteMock.mockResolvedValue(undefined);
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'Adds a delete button.',
        changeSummary: 'Added delete action.',
        appMemory: testAppMemory,
        source: 'root = AppShell([])',
      }),
      usage: null,
    });

    await expect(generateOpenUiSource(env, protectedRequest, undefined, { requestId: 'builder-request-protected-source' })).resolves.toEqual({
      summary: 'Adds a delete button.',
      changeSummary: 'Added delete action.',
      appMemory: testAppMemory,
      source: 'root = AppShell([])',
    });

    const requestInput = responsesCreateMock.mock.calls[0]?.[0]?.input;
    const finalUserText = requestInput?.at(-1)?.content?.[0]?.text ?? '';
    const allInputText = JSON.stringify(requestInput);

    expect(finalUserText).toContain(`<current_source>\n${currentSource}\n</current_source>`);
    expect(finalUserText).not.toContain('<current_source_inventory>');
    expect(allInputText).not.toContain('Create the first version.');
    expect(allInputText).not.toContain('Added the first version.');
    expect(allInputText).not.toContain('<history_summary>');
    expect(promptLogWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSourceChars: currentSource.length,
        currentSourceIncluded: true,
        currentSourceItemsIncluded: false,
        currentSourceLen: currentSource.length,
        currentSourceProtected: true,
        droppedSections: expect.arrayContaining([
          'selectedExamples',
          'previousChangeSummaries',
          'previousUserMessages',
          'historySummary',
          'currentSourceItems',
          'appMemory.userPreferences',
          'appMemory.avoid',
          'appMemory.appSummary',
        ]),
      }),
      {
        enabled: true,
      },
    );
  });

  it('rejects current source above the emergency cap before contacting the model', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-source-emergency-cap',
    });

    await expect(
      generateOpenUiSource(env, {
        chatHistory: [],
        currentSource: 'x'.repeat(50_001),
        mode: 'initial',
        prompt: 'Update the app.',
      }),
    ).rejects.toMatchObject({
      publicMessage: CURRENT_SOURCE_TOO_LARGE_PUBLIC_MESSAGE,
    });
    expect(responsesCreateMock).not.toHaveBeenCalled();
  });

  it('passes filtered conversation context into role-based repair input', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-role-based-repair-context',
    });
    const repairRequestWithHistory: PromptBuildRequest = {
      ...repairRequest,
      previousUserMessages: ['Create a signup form.', 'Add email validation.'],
      previousChangeSummaries: ['Built a signup form with an email field.'],
    };

    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'Repairs the OpenUI document.',
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, repairRequestWithHistory)).resolves.toEqual({
      summary: 'Repairs the OpenUI document.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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

      <previous_app_memory>
      {"version":1,"appSummary":"","userPreferences":[],"avoid":[]}
      </previous_app_memory>

      <conversation_context>
      - Previous user prompt: Add email validation.
      - Previous user prompt: Create a signup form.
      - Previous committed change: Built a signup form with an email field.
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

      <hints>
      - Example for todo add fragment:
        $draft = ""
        items = Query("read_state", { path: "app.items" }, [])
        addItem = Mutation("append_item", { path: "app.items", value: { title: $draft, completed: false } })
        Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
      - Example for todo list rows fragment:
        $targetItemId = ""
        toggleItem = Mutation("toggle_item_field", { path: "app.items", idField: "id", id: $targetItemId, field: "completed" })
        rows = @Each(items, "item", Group(null, "horizontal", [
          Text(item.title, "body", "start"),
          Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))
        ], "inline"))
        Repeater(rows, "No tasks yet.")
      </hints>

      Return the corrected complete OpenUI Lang program in \`source\`. Return summary, changeSummary, source, and appMemory. Make \`summary\` one user-facing sentence under 200 characters, \`changeSummary\` one technical sentence under 300 characters, and return a full updated \`appMemory\` object under 4096 characters with version, appSummary, userPreferences, and avoid only.",
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, requestWithLongHistory)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      source: 'root = AppShell([])',
    });

    const initialCall = responsesCreateMock.mock.calls[0]?.[0];

    expect(initialCall?.input).toHaveLength(3);
    expect(initialCall?.input?.[0]).toEqual({
      role: 'system',
      content: [{ type: 'input_text', text: expect.any(String) }],
    });
    expect(initialCall?.input?.[1]).toEqual({
      role: 'user',
      content: [{ type: 'input_text', text: expect.stringContaining('<intent_context>') }],
    });
    expect(initialCall?.input?.[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: expect.stringContaining('<latest_user_request>\nBuild a todo app\n</latest_user_request>'),
        },
      ],
    });
    const longHistoryFinalUserText = initialCall?.input?.[2]?.content?.[0]?.text ?? '';
    expect(longHistoryFinalUserText).toContain(
      '<previous_user_messages>\n["Start with a tiny todo app.","Add filters and a settings screen.","Add a dark mode toggle."]\n</previous_user_messages>',
    );
    expect(longHistoryFinalUserText).toContain('Added dark mode support.');
  });

  it('does not silently trim signup iteration history down to a stale assistant summary window', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-signup-history-window',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'Keeps the Continue button disabled until the email is valid.',
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, requestWithSignupIterationHistory)).resolves.toEqual({
      summary: 'Keeps the Continue button disabled until the email is valid.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      source: 'root = AppShell([])',
    });

    const initialCall = responsesCreateMock.mock.calls[0]?.[0];

    expect(initialCall?.input).toHaveLength(3);
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
    const signupFinalUserText = initialCall?.input?.at(-1)?.content?.[0]?.text ?? '';
    expect(signupFinalUserText).toContain('Create a signup form with name, email, and a required agreement checkbox.');
    expect(signupFinalUserText).toContain('Remove filter, add email validation');
    expect(signupFinalUserText).toContain('Email validation is enabled, and the email filter control has been removed.');
  });

  it('keeps the same cached system prefix and prompt cache key across initial and repair requests', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-cache',
    });
    responsesCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'Builds a blank app shell.',
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      source: 'root = AppShell([])',
    });
    await expect(generateOpenUiSource(env, repairRequest)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
        source: 'root = AppShell([])',
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      source: 'root = AppShell([])',
    });
    await expect(generateOpenUiSource(env, todoAliasRequest)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      source: 'root = AppShell([])',
    });
    await expect(generateOpenUiSource(env, themeRequest)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      source: 'root = AppShell([])',
    });

    const firstTodoCall = responsesCreateMock.mock.calls[0]?.[0];
    const secondTodoCall = responsesCreateMock.mock.calls[1]?.[0];
    const themeCall = responsesCreateMock.mock.calls[2]?.[0];

    expect(firstTodoCall?.prompt_cache_key).toBe(secondTodoCall?.prompt_cache_key);
    expect(firstTodoCall?.prompt_cache_key).toMatch(/^kitto:openui:t:[a-f0-9]{12}$/);
    expect(themeCall?.prompt_cache_key).toMatch(/^kitto:openui:th:[a-f0-9]{12}$/);
    expect(themeCall?.prompt_cache_key).not.toBe(firstTodoCall?.prompt_cache_key);
    expect(firstTodoCall?.input?.[0]?.content?.[0]?.text).not.toContain('APPEARANCE / THEME CONTRACT:');
    expect(themeCall?.input?.[0]?.content?.[0]?.text).toContain('APPEARANCE / THEME CONTRACT:');
    expect(themeCall?.input?.at(-2)?.content?.[0]?.text).not.toContain('APPEARANCE / THEME CONTRACT:');
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
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
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
        source: 'root = AppShell([])',
      }),
      usage,
    });
    const expectedSystemPromptHash = getOpenUiSystemPromptHash(
      detectPromptRequestIntent(request.prompt, {
        currentSource: request.currentSource,
        mode: request.mode,
      }),
    );

    expect(expectedSystemPromptHash).not.toBe(getOpenUiSystemPromptHash());

    await expect(generateOpenUiSource(env, request, undefined, { requestId: 'builder-request-1' })).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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
        systemPromptHash: expectedSystemPromptHash,
        modelOutputRaw: createEnvelopeText('Builds a blank app shell.', 'root = AppShell([])'),
        parsedEnvelope: {
          summary: 'Builds a blank app shell.',
          changeSummary: 'Test generation change.',
          appMemory: testAppMemory,
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
        source: 'root = AppShell([])',
      }),
      usage: null,
    });

    await expect(
      generateOpenUiSource(env, repairRequestWithAttempt, undefined, { requestId: 'builder-request-repair-2' }),
    ).resolves.toEqual({
      summary: 'Repairs the app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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

    promptLogWriteMock.mockResolvedValue(undefined);
    responsesCreateMock.mockResolvedValue({
      output_text: 'not-json',
      usage: {
        input_tokens: 10,
      },
    });

    await expect(generateOpenUiSource(env, repairRequestWithContext, undefined, { requestId: 'builder-request-repair' })).rejects.toBeInstanceOf(
      UpstreamFailureError,
    );

    expect(promptLogWriteMock).toHaveBeenCalledWith(
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
    promptLogWriteMock.mockResolvedValue(undefined);
    responsesCreateMock.mockRejectedValue(timeoutError);

    await expect(generateOpenUiSource(env, request, undefined, { requestId: 'builder-request-timeout' })).rejects.toBe(timeoutError);

    expect(promptLogWriteMock).toHaveBeenCalledWith(
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
      }),
    });

    await expect(generateOpenUiSource(env, request)).resolves.toEqual({
      source: 'root = AppShell([])',
      summary: 'Builds a simple one-screen app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
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
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
      }),
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
  });

});

describe('streamOpenUiSource', () => {
  afterEach(() => {
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
      { output_text: createEnvelopeText('Builds a blank app shell.', 'root = AppShell([])') },
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
      output_text: createEnvelopeText('Builds a blank app shell.', 'root = AppShell([])'),
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
      { output_text: createEnvelopeText('Builds a blank app shell.', 'root = AppShell([])') },
    );

    promptLogWriteMock.mockResolvedValue(undefined);
    responsesStreamMock.mockReturnValue(stream);

    await expect(
      streamOpenUiSource(env, request, onTextDelta, abortController.signal, { requestId: 'builder-request-client-abort' }),
    ).rejects.toBeInstanceOf(MockApiUserAbortError);

    expect(promptLogWriteMock).toHaveBeenCalledWith(
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
      { output_text: createEnvelopeText('Builds a blank app shell.', 'root = AppShell([])') },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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
      LLM_OUTPUT_MAX_BYTES: 500,
    });
    const onTextDelta = vi.fn();
    const oversizedSource = 'x'.repeat(501);
    const rawEnvelope = JSON.stringify({
      summary: '',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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
      output_text: createEnvelopeText('Builds a blank app shell.', 'root = AppShell([])'),
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
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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
        output_text: createEnvelopeText('Builds a blank app shell.', 'root = AppShell([])'),
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
    ).resolves.toBe(createEnvelopeText('Builds a blank app shell.', 'root = AppShell([])'));

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
        output_text: createEnvelopeText('Builds a different app shell.', 'root = AppShell([Text("Changed", "body", "start")])'),
      },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).resolves.toEqual({
      summary: 'Builds a different app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
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
        output_text: createEnvelopeText('Builds a blank app shell.', 'root = AppShell([])'),
        usage,
      },
    );
    promptLogWriteMock.mockResolvedValue(undefined);
    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta, undefined, { requestId: 'builder-request-stream' })).resolves.toEqual({
      summary: 'Builds a blank app shell.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      source: 'root = AppShell([])',
    });

    expect(promptLogWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'builder-request-stream',
        rawUserRequest: 'Build a todo app',
        inputShape: 'role-based',
        modelOutputRaw: createEnvelopeText('Builds a blank app shell.', 'root = AppShell([])'),
        parsedEnvelope: {
          summary: 'Builds a blank app shell.',
          changeSummary: 'Test generation change.',
          appMemory: testAppMemory,
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
    promptLogWriteMock.mockResolvedValue(undefined);
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

    expect(promptLogWriteMock).toHaveBeenCalledWith(
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
