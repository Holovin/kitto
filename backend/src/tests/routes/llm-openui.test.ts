import { APIError, APIUserAbortError } from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '#backend/app.js';
import { UpstreamFailureError } from '#backend/errors/publicError.js';
import { createTestEnv } from '#backend/tests/createTestEnv.js';

const {
  writePromptIoCommitTelemetrySafelyMock,
  writePromptIoIntakeFailureSafelyMock,
} = vi.hoisted(() => ({
  writePromptIoCommitTelemetrySafelyMock: vi.fn(),
  writePromptIoIntakeFailureSafelyMock: vi.fn(),
}));

vi.mock(import('#backend/services/openai.js'), () => ({
  generateOpenUiSource: vi.fn(),
  streamOpenUiSource: vi.fn(),
}));

vi.mock(import('#backend/services/openai/logging.js'), () => ({
  writePromptIoCommitTelemetrySafely: writePromptIoCommitTelemetrySafelyMock,
  writePromptIoIntakeFailureSafely: writePromptIoIntakeFailureSafelyMock,
}));

import { generateOpenUiSource, streamOpenUiSource } from '#backend/services/openai.js';
import { getRawRequestMaxBytes } from '#backend/limits.js';

const generateOpenUiSourceMock = vi.mocked(generateOpenUiSource);
const streamOpenUiSourceMock = vi.mocked(streamOpenUiSource);
const textEncoder = new TextEncoder();
const unresolvedReferenceIssue = {
  code: 'unresolved-reference',
  message: 'This statement was referenced but never defined in the final source.',
  source: 'parser' as const,
  statementId: 'items',
};
const undefinedStateReferenceIssue = {
  code: 'undefined-state-reference',
  context: {
    exampleInitializer: '""',
    refName: '$filter',
  },
  message: 'State reference `$filter` is missing a top-level declaration with a literal initial value. For example, add `$filter = ""`.',
  source: 'quality' as const,
  statementId: 'root',
};
const dynamicBlockingQualityIssue = {
  code: 'quality-missing-todo-controls',
  message: 'Todo request did not generate required todo controls.',
  severity: 'blocking-quality' as const,
  source: 'quality' as const,
};
const testAppMemory = {
  version: 1 as const,
  appSummary: 'Test app',
  userPreferences: ['Keep the test UI compact.'],
  avoid: [],
};

function createRouteApp(envOverrides: Parameters<typeof createTestEnv>[0] = {}) {
  const env = createTestEnv(envOverrides);
  const app = createApp(env);

  return { app, env };
}

function createStreamingBody(body: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(textEncoder.encode(body));
      controller.close();
    },
  });
}

function parseSseEvents(payload: string) {
  return payload
    .split('\n\n')
    .filter(Boolean)
    .map((entry) => {
      const lines = entry.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length) ?? '';
      const data = lines
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
        .join('\n');

      return { data, event };
    });
}

describe('createLlmOpenUiRoutes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    generateOpenUiSourceMock.mockReset();
    streamOpenUiSourceMock.mockReset();
    writePromptIoCommitTelemetrySafelyMock.mockReset();
    writePromptIoIntakeFailureSafelyMock.mockReset();
    vi.restoreAllMocks();
  });

  it('rejects invalid JSON bodies before calling the OpenAI service', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"prompt":',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Request body must be valid JSON.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
    expect(writePromptIoIntakeFailureSafelyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'validation_error',
        errorMessage: 'Request body must be valid JSON.',
        requestBytes: Buffer.byteLength('{"prompt":', 'utf8'),
      }),
    );
  });

  it('rejects invalid JSON stream bodies before calling the OpenAI service', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"prompt":',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Request body must be valid JSON.',
      status: 400,
    });
    expect(streamOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('logs an intake validation error for empty request bodies', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '',
    });

    expect(response.status).toBe(400);
    expect(writePromptIoIntakeFailureSafelyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'validation_error',
        errorMessage: 'Request body must be valid JSON.',
        requestBytes: 0,
      }),
    );
  });

  it('rejects empty prompts before calling the OpenAI service', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: '',
        currentSource: '',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
    expect(writePromptIoIntakeFailureSafelyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'validation_error',
        errorMessage: 'The request payload is invalid.',
        requestBytes: expect.any(Number),
      }),
    );
  });

  it('rejects empty stream prompts before calling the OpenAI service', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: '',
        currentSource: '',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(streamOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects oversized prompts with a validation error', async () => {
    const { app } = createRouteApp({
      LLM_USER_PROMPT_MAX_CHARS: 8,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'this is too long',
        currentSource: '',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Prompt is too large. Limit: 8 characters.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects oversized current source before calling the OpenAI service', async () => {
    const { app } = createRouteApp({
      LLM_MODEL_PROMPT_MAX_CHARS: 8,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'update',
        currentSource: 'root = AppShell([])',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Current source is too large. Limit: 8 characters.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects current source above the hard source cap even when the model prompt limit is higher', async () => {
    const { app } = createRouteApp({
      LLM_MODEL_PROMPT_MAX_CHARS: 20_000,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'update',
        currentSource: 'x'.repeat(18_001),
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Current source is too large. Limit: 18000 characters.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects oversized invalid drafts before repair generation', async () => {
    const { app } = createRouteApp({
      LLM_MODEL_PROMPT_MAX_CHARS: 8,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'repair it',
        currentSource: '',
        invalidDraft: 'root = AppShell([])',
        mode: 'repair',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Invalid draft is too large. Limit: 8 characters.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects oversized individual chat history messages before compaction', async () => {
    const { app } = createRouteApp({
      LLM_USER_PROMPT_MAX_CHARS: 8,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'update',
        currentSource: '',
        chatHistory: [{ role: 'user', content: 'this message is too long' }],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Chat history is too large.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects oversized Content-Length before parsing or calling the OpenAI service', async () => {
    const { app, env } = createRouteApp({
      LLM_REQUEST_MAX_BYTES: 20,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-length': String(getRawRequestMaxBytes(env) + 1),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'ok',
        currentSource: '',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Request body is too large to process safely.',
      status: 413,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
    expect(writePromptIoIntakeFailureSafelyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'validation_error',
        errorMessage: `Request body exceeded the raw request limit of ${getRawRequestMaxBytes(env)} bytes.`,
        requestBytes: getRawRequestMaxBytes(env) + 1,
      }),
    );
  });

  it('rejects oversized streamed bodies before parsing or calling the OpenAI service', async () => {
    const { app } = createRouteApp({
      LLM_REQUEST_MAX_BYTES: 20,
    });
    const oversizedBody = JSON.stringify({
      prompt: 'x'.repeat(60),
      currentSource: '',
      chatHistory: [],
    });
    const requestInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: createStreamingBody(oversizedBody),
      duplex: 'half',
    };

    const response = await app.request('/api/llm/generate', requestInit);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Request body is too large to process safely.',
      status: 413,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects oversized model output with a controlled upstream error', async () => {
    const { app } = createRouteApp({
      LLM_OUTPUT_MAX_BYTES: 12,
    });
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '', changeSummary: 'Test generation change.', appMemory: testAppMemory });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'generate a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: 'upstream_error',
      error: 'The model service could not complete the request.',
      status: 502,
    });
    expect(generateOpenUiSourceMock).toHaveBeenCalledTimes(1);
  });

  it('sanitizes OpenAI SDK errors that contain a fake API key before responding to clients', async () => {
    const { app } = createRouteApp();
    const fakeApiKey = 'sk-live-test-1234567890abcdef';
    const sensitiveMessage = `OpenAI upstream failed while using ${fakeApiKey}`;

    generateOpenUiSourceMock.mockRejectedValue(
      new APIError(
        500,
        {
          message: sensitiveMessage,
          type: 'server_error',
        },
        undefined,
        new Headers({ 'x-request-id': 'req-sensitive' }),
      ),
    );

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'generate a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const payload = (await response.json()) as {
      code: string;
      error: string;
      status: number;
    };

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      code: 'upstream_error',
      error: 'The model service could not complete the request.',
      status: 502,
    });
    expect(payload.code).toBe('upstream_error');
    expect(JSON.stringify(payload)).not.toContain(sensitiveMessage);
    expect(JSON.stringify(payload)).not.toContain(fakeApiKey);
  });

  it('compacts chat history by item limit while preserving the first user request without orphaning an assistant summary', async () => {
    const { app, env } = createRouteApp({
      LLM_CHAT_HISTORY_MAX_ITEMS: 2,
      OPENAI_MODEL: 'gpt-test-model',
    });
    const chatHistory = [
      { role: 'user' as const, content: 'oldest user message' },
      { role: 'assistant' as const, content: 'oldest assistant reply' },
      { role: 'user' as const, content: 'recent user message' },
      { role: 'assistant' as const, content: 'most recent assistant reply' },
    ];
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a compact app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'build a compact app',
        currentSource: '',
        chatHistory,
      }),
    });
    const payload = await response.json();
    const [calledEnv, calledRequest, calledSignal] = generateOpenUiSourceMock.mock.calls[0] ?? [];

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      compaction: {
        compactedByBytes: false,
        compactedByItemLimit: true,
        omittedChatMessages: 2,
      },
      model: 'gpt-test-model',
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: 'Builds a compact app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      temperature: 0.4,
    });
    expect(calledEnv).toBe(env);
    expect(calledRequest).toEqual({
      prompt: 'build a compact app',
      currentSource: '',
      mode: 'initial',
      chatHistory: [chatHistory[0], chatHistory[2]],
    });
    expect(calledSignal).toBeInstanceOf(AbortSignal);
    expect(generateOpenUiSourceMock.mock.calls[0]?.[3]).toEqual({
      compactedRequestBytes: expect.any(Number),
      omittedChatMessages: 2,
      requestBytes: expect.any(Number),
      requestId: expect.any(String),
    });
  });

  it('drops system chat messages before compaction and generation', async () => {
    const { app } = createRouteApp({
      LLM_CHAT_HISTORY_MAX_ITEMS: 2,
      OPENAI_MODEL: 'gpt-test-model',
    });
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a compact app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'build a compact app',
        currentSource: '',
        chatHistory: [
          { role: 'system', content: 'internal UI notice' },
          { role: 'user', content: 'oldest user message' },
          { role: 'system', content: 'automatic repair notice' },
          { role: 'assistant', content: 'recent assistant reply' },
          { role: 'user', content: 'most recent user message' },
        ],
      }),
    });
    const payload = await response.json();
    const [, calledRequest] = generateOpenUiSourceMock.mock.calls[0] ?? [];

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      compaction: {
        compactedByBytes: false,
        compactedByItemLimit: true,
        omittedChatMessages: 1,
      },
      model: 'gpt-test-model',
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: 'Builds a compact app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      temperature: 0.4,
    });
    expect(calledRequest).toEqual({
      prompt: 'build a compact app',
      currentSource: '',
      mode: 'initial',
      chatHistory: [
        { role: 'user', content: 'oldest user message' },
        { role: 'user', content: 'most recent user message' },
      ],
    });
  });

  it('filters excludeFromLlmContext before compaction and generation', async () => {
    const { app } = createRouteApp({
      LLM_CHAT_HISTORY_MAX_ITEMS: 5,
    });
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '', changeSummary: 'Test generation change.', appMemory: testAppMemory });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'build a compact app',
        currentSource: '',
        chatHistory: [
          { role: 'assistant', content: 'Updated the app definition from the latest chat instruction.', excludeFromLlmContext: true },
          { role: 'assistant', content: 'Updated the app.', excludeFromLlmContext: true },
          { role: 'assistant', content: 'Added a compact filter row and preserved the previous layout.' },
          { role: 'assistant', content: 'Keep this out of context.', excludeFromLlmContext: true },
          { role: 'user', content: 'Add sorting controls.' },
        ],
      }),
    });
    const [, calledRequest] = generateOpenUiSourceMock.mock.calls[0] ?? [];

    expect(response.status).toBe(200);
    expect(calledRequest).toEqual({
      prompt: 'build a compact app',
      currentSource: '',
      mode: 'initial',
      chatHistory: [
        { role: 'assistant', content: 'Added a compact filter row and preserved the previous layout.' },
        { role: 'user', content: 'Add sorting controls.' },
      ],
    });
  });

  it('marks low-signal non-stream summaries to stay out of LLM context', async () => {
    const { app } = createRouteApp({
      OPENAI_MODEL: 'gpt-test-model',
    });
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Updated the app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'build a compact app',
        currentSource: '',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      model: 'gpt-test-model',
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: 'Updated the app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      summaryExcludeFromLlmContext: true,
      summaryWarning: 'The model returned a generic summary; it was kept visible but excluded from future model context.',
      temperature: 0.4,
    });
  });

  it('passes through explicit repair mode to the OpenAI service request', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '', changeSummary: 'Test generation change.', appMemory: testAppMemory });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'repair this invalid app',
        currentSource: 'root = AppShell([])',
        invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
        mode: 'repair',
        chatHistory: [],
      }),
    });
    const [, calledRequest] = generateOpenUiSourceMock.mock.calls[0] ?? [];

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      model: 'gpt-5.4-mini',
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: '',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      temperature: 0.2,
    });
    expect(calledRequest).toEqual({
      prompt: 'repair this invalid app',
      currentSource: 'root = AppShell([])',
      mode: 'repair',
      invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
      chatHistory: [],
    });
  });

  it('rejects repair requests without an invalid draft before calling the OpenAI service', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'repair this invalid app',
        currentSource: 'root = AppShell([])',
        mode: 'repair',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects repair-shaped requests without an explicit mode before calling the OpenAI service', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'repair this invalid app',
        currentSource: 'root = AppShell([])',
        invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects invalid drafts on initial requests before calling the OpenAI service', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'build a compact app',
        currentSource: '',
        invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
        mode: 'initial',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects undefined-state repair issues without structured context', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'repair this invalid app',
        currentSource: 'root = AppShell([])',
        invalidDraft: 'root = AppShell([Text($filter, "body", "start")])',
        mode: 'repair',
        validationIssues: [
          {
            code: 'undefined-state-reference',
            message: 'State reference `$filter` is missing a top-level declaration with a literal initial value.',
            source: 'quality',
            statementId: 'root',
          },
        ],
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects structured validation context on issue codes that do not support it', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'repair this invalid app',
        currentSource: 'root = AppShell([])',
        invalidDraft: 'root = AppShell([Group("Bad", "block", [])])',
        mode: 'repair',
        validationIssues: [
          {
            ...unresolvedReferenceIssue,
            context: {
              exampleInitializer: '""',
              refName: '$filter',
            },
          },
        ],
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects stale persisted-query repair issues without structured context', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'repair this invalid app',
        currentSource: 'root = AppShell([])',
        invalidDraft: 'root = AppShell([Button("add", "Add", "default", Action([@Run(addItem)]), false)])',
        mode: 'repair',
        validationIssues: [
          {
            code: 'quality-stale-persisted-query',
            message:
              'Persisted mutation may not refresh visible query. After @Run(addItem), also run @Run(items) later in the same Action for affected path "app.items".',
            source: 'quality',
            statementId: 'addItem',
          },
        ],
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects options-shape repair issues without structured context', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'repair this invalid app',
        currentSource: 'root = AppShell([])',
        invalidDraft: 'options = ["A"]\nroot = AppShell([])',
        mode: 'repair',
        validationIssues: [
          {
            code: 'quality-options-shape',
            message: 'RadioGroup/Select options must be `{label, value}` objects, not bare strings or numbers.',
            source: 'quality',
            statementId: 'options',
          },
        ],
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('passes parentRequestId and validationIssues through to the OpenAI service request', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '', changeSummary: 'Test generation change.', appMemory: testAppMemory });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'repair this invalid app',
        currentSource: 'root = AppShell([])',
        invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
        mode: 'repair',
        parentRequestId: 'builder-request-parent',
        validationIssues: [unresolvedReferenceIssue, undefinedStateReferenceIssue, dynamicBlockingQualityIssue],
        chatHistory: [],
      }),
    });
    const [, calledRequest] = generateOpenUiSourceMock.mock.calls[0] ?? [];

    expect(response.status).toBe(200);
    expect(calledRequest).toEqual({
      prompt: 'repair this invalid app',
      currentSource: 'root = AppShell([])',
      invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
      mode: 'repair',
      parentRequestId: 'builder-request-parent',
      validationIssues: [unresolvedReferenceIssue, undefinedStateReferenceIssue, dynamicBlockingQualityIssue],
      chatHistory: [],
    });
  });

  it('passes x-kitto-request-id through to the non-stream OpenAI service call', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '', changeSummary: 'Test generation change.', appMemory: testAppMemory });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-123',
      },
      body: JSON.stringify({
        prompt: 'generate a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const [, , , calledTelemetry] = generateOpenUiSourceMock.mock.calls[0] ?? [];

    expect(response.status).toBe(200);
    expect(calledTelemetry).toEqual(
      expect.objectContaining({
        requestId: 'builder-request-123',
      }),
    );
  });

  it('compacts oversized requests by bytes while preserving the first user request when possible', async () => {
    const { app } = createRouteApp({
      LLM_REQUEST_MAX_BYTES: 260,
    });
    const chatHistory = [
      { role: 'user' as const, content: 'a'.repeat(120) },
      { role: 'assistant' as const, content: 'b'.repeat(120) },
      { role: 'user' as const, content: 'c'.repeat(120) },
    ];
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '', changeSummary: 'Test generation change.', appMemory: testAppMemory });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'trim this request',
        currentSource: '',
        chatHistory,
      }),
    });
    const payload = await response.json();
    const generateCall = generateOpenUiSourceMock.mock.calls[0];

    expect(response.status).toBe(200);
    expect(generateCall).toBeDefined();
    if (!generateCall) {
      throw new Error('Expected generateOpenUiSource to be called.');
    }

    const [, calledRequest] = generateCall;

    expect(calledRequest.chatHistory.length).toBeLessThan(chatHistory.length);
    expect(calledRequest.chatHistory[0]).toEqual(chatHistory[0]);
    expect(calledRequest.chatHistory).toEqual([chatHistory[0]]);
    expect(payload).toEqual({
      compaction: {
        compactedByBytes: true,
        compactedByItemLimit: false,
        omittedChatMessages: 2,
      },
      model: 'gpt-5.4-mini',
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: '',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      temperature: 0.4,
    });
  });

  it('streams raw structured chunks and emits the extracted source in the done event', async () => {
    const { app, env } = createRouteApp({
      OPENAI_MODEL: 'gpt-stream-model',
    });
    streamOpenUiSourceMock.mockImplementation(async (_env, _request, onTextDelta) => {
      await onTextDelta('{"summary":"Builds a tiny app.","source":"root = ');
      await onTextDelta('AppShell([])"}');
      return {
        source: 'root = AppShell([])',
        summary: 'Builds a tiny app.',
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
      };
    });

    const response = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'stream a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const payload = await response.text();
    const events = parseSseEvents(payload);
    const [calledEnv, calledRequest, , calledSignal, calledTelemetry] = streamOpenUiSourceMock.mock.calls[0] ?? [];

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(calledEnv).toBe(env);
    expect(calledRequest).toEqual({
      prompt: 'stream a tiny app',
      currentSource: '',
      mode: 'initial',
      chatHistory: [],
    });
    expect(calledSignal).toBeInstanceOf(AbortSignal);
    expect(calledTelemetry).toEqual(
      expect.objectContaining({
        compactedRequestBytes: expect.any(Number),
        omittedChatMessages: 0,
        requestBytes: expect.any(Number),
        requestId: expect.any(String),
      }),
    );
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ event: 'chunk', data: '{"summary":"Builds a tiny app.","source":"root = ' });
    expect(events[1]).toEqual({ event: 'chunk', data: 'AppShell([])"}' });
    expect(events[2]?.event).toBe('done');
    expect(JSON.parse(events[2]?.data ?? '{}')).toEqual({
      model: 'gpt-stream-model',
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      temperature: 0.4,
    });
  });

  it('includes summaryExcludeFromLlmContext in done events for low-signal streamed summaries', async () => {
    const { app } = createRouteApp({
      OPENAI_MODEL: 'gpt-stream-model',
    });
    streamOpenUiSourceMock.mockImplementation(async (_env, _request, onTextDelta) => {
      await onTextDelta('{"summary":"Updated the app.","source":"root = ');
      await onTextDelta('AppShell([])"}');
      return {
        source: 'root = AppShell([])',
        summary: 'Updated the app.',
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
      };
    });

    const response = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'stream a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(JSON.parse(events[2]?.data ?? '{}')).toEqual({
      model: 'gpt-stream-model',
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: 'Updated the app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      summaryExcludeFromLlmContext: true,
      summaryWarning: 'The model returned a generic summary; it was kept visible but excluded from future model context.',
      temperature: 0.4,
    });
  });

  it('matches the baseline full SSE stream payload', async () => {
    const { app } = createRouteApp({
      OPENAI_MODEL: 'gpt-stream-model',
    });
    streamOpenUiSourceMock.mockImplementation(async (_env, _request, onTextDelta) => {
      await onTextDelta('{"summary":"Builds a tiny app.","source":"root = ');
      await onTextDelta('AppShell([])"}');
      return {
        source: 'root = AppShell([])',
        summary: 'Builds a tiny app.',
        changeSummary: 'Test generation change.',
        appMemory: testAppMemory,
      };
    });

    const response = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'stream a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const events = parseSseEvents(await response.text()).map((event) =>
      event.event === 'done' ? { ...event, data: JSON.parse(event.data) } : event,
    );

    expect({
      headers: {
        contentType: response.headers.get('content-type'),
        xAccelBuffering: response.headers.get('x-accel-buffering'),
      },
      status: response.status,
      events,
    }).toMatchInlineSnapshot(`
      {
        "events": [
          {
            "data": "{"summary":"Builds a tiny app.","source":"root = ",
            "event": "chunk",
          },
          {
            "data": "AppShell([])"}",
            "event": "chunk",
          },
          {
            "data": {
              "appMemory": {
                "appSummary": "Test app",
                "avoid": [],
                "userPreferences": [
                  "Keep the test UI compact.",
                ],
                "version": 1,
              },
              "changeSummary": "Test generation change.",
              "model": "gpt-stream-model",
              "qualityIssues": [],
              "source": "root = AppShell([])",
              "summary": "Builds a tiny app.",
              "temperature": 0.4,
            },
            "event": "done",
          },
        ],
        "headers": {
          "contentType": "text/event-stream; charset=utf-8",
          "xAccelBuffering": "no",
        },
        "status": 200,
      }
    `);
  });

  it('returns prompt-aware quality issues in the response payload', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({
      source: `root = AppShell([
  Screen("main", "Todo", [
    Text("Todo", "title", "start")
  ])
])`,
      summary: 'Builds a todo draft.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'Build a todo app',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      model: 'gpt-5.4-mini',
      qualityIssues: [
        {
          code: 'quality-missing-todo-controls',
          message: 'Todo request did not generate required todo controls.',
          severity: 'blocking-quality',
          source: 'quality',
        },
      ],
      source: `root = AppShell([
  Screen("main", "Todo", [
    Text("Todo", "title", "start")
  ])
])`,
      summary: 'Builds a todo draft.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      temperature: 0.4,
    });
  });

  it('passes x-kitto-request-id through to the streaming OpenAI service call', async () => {
    const { app } = createRouteApp();
    streamOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const response = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-stream-123',
      },
      body: JSON.stringify({
        prompt: 'stream a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const [, , , , calledTelemetry] = streamOpenUiSourceMock.mock.calls[0] ?? [];

    expect(response.status).toBe(200);
    expect(calledTelemetry).toEqual(
      expect.objectContaining({
        requestId: 'builder-stream-123',
      }),
    );
  });

  it('does not count a marked fallback after a pre-activity stream failure as a second rate-limit request', async () => {
    const { app } = createRouteApp({
      LLM_RATE_LIMIT_MAX_REQUESTS: 1,
      LLM_RATE_LIMIT_WINDOW_MS: 60_000,
    });
    const timeoutError = new Error('Timed out while waiting for the model stream.');
    timeoutError.name = 'TimeoutError';
    streamOpenUiSourceMock.mockRejectedValue(timeoutError);
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Adds a welcome screen.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });
    const body = JSON.stringify({
      prompt: 'generate a tiny app',
      currentSource: '',
      chatHistory: [],
    });

    const streamResponse = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body,
    });
    const streamEvents = parseSseEvents(await streamResponse.text());
    const fallbackResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
        'x-kitto-stream-fallback': '1',
      },
      body,
    });
    const nextResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-next',
      },
      body,
    });

    expect(streamResponse.status).toBe(200);
    expect(streamEvents).toEqual([
      {
        event: 'error',
        data: '{"code":"timeout_error","error":"The model request timed out.","status":504}',
      },
    ]);
    expect(fallbackResponse.status).toBe(200);
    expect(nextResponse.status).toBe(429);
    expect(generateOpenUiSourceMock).toHaveBeenCalledTimes(1);
  });

  it('does not read streaming request bodies while recording rate-limit rejections', async () => {
    const { app } = createRouteApp({
      LLM_RATE_LIMIT_MAX_REQUESTS: 1,
      LLM_RATE_LIMIT_WINDOW_MS: 60_000,
      LLM_REQUEST_MAX_BYTES: 2,
    });

    const firstResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{',
    });
    const rateLimitedRequestInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: createStreamingBody(
        JSON.stringify({
          prompt: 'generate a tiny app',
          currentSource: '',
          chatHistory: [],
        }),
      ),
      duplex: 'half',
    };
    const rateLimitedResponse = await app.request('/api/llm/generate', rateLimitedRequestInit);

    expect(firstResponse.status).toBe(400);
    expect(rateLimitedResponse.status).toBe(429);
    expect(await rateLimitedResponse.json()).toEqual({
      error: 'Too many LLM requests. Please wait a moment and try again.',
    });
    expect(writePromptIoIntakeFailureSafelyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'rate_limited',
        requestBytes: null,
      }),
    );
  });

  it('does not grant a fallback rate-limit exemption after a pre-activity upstream API error', async () => {
    const { app } = createRouteApp({
      LLM_RATE_LIMIT_MAX_REQUESTS: 1,
      LLM_RATE_LIMIT_WINDOW_MS: 60_000,
    });
    streamOpenUiSourceMock.mockRejectedValue(
      new APIError(
        500,
        {
          message: 'The upstream service failed before streaming content.',
          type: 'server_error',
        },
        undefined,
        new Headers({ 'x-request-id': 'req-pre-activity-upstream' }),
      ),
    );
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });
    const body = JSON.stringify({
      prompt: 'generate a tiny app',
      currentSource: '',
      chatHistory: [],
    });

    const streamResponse = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body,
    });
    const streamEvents = parseSseEvents(await streamResponse.text());
    const fallbackResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
        'x-kitto-stream-fallback': '1',
      },
      body,
    });

    expect(streamResponse.status).toBe(200);
    expect(streamEvents).toEqual([
      {
        event: 'error',
        data: '{"code":"upstream_error","error":"The model service could not complete the request.","status":502}',
      },
    ]);
    expect(fallbackResponse.status).toBe(429);
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('does not count a marked automatic repair after a completed parent generation as a second rate-limit request', async () => {
    const { app } = createRouteApp({
      LLM_RATE_LIMIT_MAX_REQUESTS: 1,
      LLM_RATE_LIMIT_WINDOW_MS: 60_000,
    });
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });
    const initialBody = JSON.stringify({
      prompt: 'generate a tiny app',
      currentSource: '',
      chatHistory: [],
    });
    const repairBody = JSON.stringify({
      prompt: 'generate a tiny app',
      currentSource: '',
      invalidDraft: 'root = AppShell([missing])',
      mode: 'repair',
      parentRequestId: 'builder-request-parent',
      repairAttemptNumber: 1,
      validationIssues: [unresolvedReferenceIssue],
      chatHistory: [],
    });

    const initialResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: initialBody,
    });
    const repairResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-automatic-repair': '1',
        'x-kitto-repair-attempt': '1',
        'x-kitto-repair-for': 'builder-request-parent',
        'x-kitto-request-id': 'builder-request-repair-1',
      },
      body: repairBody,
    });
    const nextResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-next',
      },
      body: initialBody,
    });

    expect(initialResponse.status).toBe(200);
    expect(repairResponse.status).toBe(200);
    expect(nextResponse.status).toBe(429);
    expect(generateOpenUiSourceMock).toHaveBeenCalledTimes(2);
  });

  it('does not grant an automatic repair rate-limit exemption without a recorded parent generation', async () => {
    const { app } = createRouteApp({
      LLM_RATE_LIMIT_MAX_REQUESTS: 1,
      LLM_RATE_LIMIT_WINDOW_MS: 60_000,
    });
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });
    const initialBody = JSON.stringify({
      prompt: 'generate a tiny app',
      currentSource: '',
      chatHistory: [],
    });
    const repairBody = JSON.stringify({
      prompt: 'generate a tiny app',
      currentSource: '',
      invalidDraft: 'root = AppShell([missing])',
      mode: 'repair',
      parentRequestId: 'missing-parent-request',
      repairAttemptNumber: 1,
      validationIssues: [unresolvedReferenceIssue],
      chatHistory: [],
    });

    const initialResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: initialBody,
    });
    const repairResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-automatic-repair': '1',
        'x-kitto-repair-attempt': '1',
        'x-kitto-repair-for': 'missing-parent-request',
        'x-kitto-request-id': 'builder-request-repair-1',
      },
      body: repairBody,
    });

    expect(initialResponse.status).toBe(200);
    expect(repairResponse.status).toBe(429);
    expect(generateOpenUiSourceMock).toHaveBeenCalledTimes(1);
  });

  it('rejects automatic repair transport metadata that does not match the request body', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });
    const initialBody = JSON.stringify({
      prompt: 'generate a tiny app',
      currentSource: '',
      chatHistory: [],
    });
    const mismatchedRepairBody = JSON.stringify({
      prompt: 'generate a tiny app',
      currentSource: '',
      invalidDraft: 'root = AppShell([missing])',
      mode: 'repair',
      parentRequestId: 'different-parent-request',
      repairAttemptNumber: 1,
      validationIssues: [unresolvedReferenceIssue],
      chatHistory: [],
    });

    const initialResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: initialBody,
    });
    const repairResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-automatic-repair': '1',
        'x-kitto-repair-attempt': '1',
        'x-kitto-repair-for': 'builder-request-parent',
        'x-kitto-request-id': 'builder-request-repair-1',
      },
      body: mismatchedRepairBody,
    });

    expect(initialResponse.status).toBe(200);
    expect(repairResponse.status).toBe(400);
    expect(await repairResponse.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).toHaveBeenCalledTimes(1);
  });

  it('records one automatic repair credit per configured repair attempt', async () => {
    const { app } = createRouteApp({
      LLM_MAX_REPAIR_ATTEMPTS: 2,
      LLM_RATE_LIMIT_MAX_REQUESTS: 1,
      LLM_RATE_LIMIT_WINDOW_MS: 60_000,
    });
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });
    const initialBody = JSON.stringify({
      prompt: 'generate a tiny app',
      currentSource: '',
      chatHistory: [],
    });
    const createRepairBody = (attemptNumber: number) =>
      JSON.stringify({
        prompt: 'generate a tiny app',
        currentSource: '',
        invalidDraft: 'root = AppShell([missing])',
        mode: 'repair',
        parentRequestId: 'builder-request-parent',
        repairAttemptNumber: attemptNumber,
        validationIssues: [unresolvedReferenceIssue],
        chatHistory: [],
      });
    const sendRepair = (attemptNumber: number) =>
      app.request('/api/llm/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-kitto-automatic-repair': '1',
          'x-kitto-repair-attempt': String(attemptNumber),
          'x-kitto-repair-for': 'builder-request-parent',
          'x-kitto-request-id': `builder-request-repair-${attemptNumber}`,
        },
        body: createRepairBody(attemptNumber),
      });

    const initialResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: initialBody,
    });
    const firstRepairResponse = await sendRepair(1);
    const secondRepairResponse = await sendRepair(2);
    const thirdRepairResponse = await sendRepair(3);

    expect(initialResponse.status).toBe(200);
    expect(firstRepairResponse.status).toBe(200);
    expect(secondRepairResponse.status).toBe(200);
    expect(thirdRepairResponse.status).toBe(429);
    expect(generateOpenUiSourceMock).toHaveBeenCalledTimes(3);
  });

  it('does not grant a fallback rate-limit exemption after streaming activity was sent', async () => {
    const { app } = createRouteApp({
      LLM_RATE_LIMIT_MAX_REQUESTS: 1,
      LLM_RATE_LIMIT_WINDOW_MS: 60_000,
    });
    streamOpenUiSourceMock.mockImplementation(async (_env, _request, onTextDelta) => {
      onTextDelta('root = ');
      throw new UpstreamFailureError('The stream failed after emitting content.');
    });
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });
    const body = JSON.stringify({
      prompt: 'generate a tiny app',
      currentSource: '',
      chatHistory: [],
    });

    const streamResponse = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body,
    });
    const streamEvents = parseSseEvents(await streamResponse.text());
    const fallbackResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
        'x-kitto-stream-fallback': '1',
      },
      body,
    });

    expect(streamResponse.status).toBe(200);
    expect(streamEvents).toEqual([
      { event: 'chunk', data: 'root = ' },
      {
        event: 'error',
        data: '{"code":"upstream_error","error":"The model service could not complete the request.","status":502}',
      },
    ]);
    expect(fallbackResponse.status).toBe(429);
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('closes the SSE stream without done or error when the upstream stream is aborted', async () => {
    const { app } = createRouteApp();
    streamOpenUiSourceMock.mockImplementation(async (_env, _request, onTextDelta) => {
      await onTextDelta('root = ');
      throw new APIUserAbortError();
    });

    const response = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'abort the stream',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(events).toEqual([{ event: 'chunk', data: 'root = ' }]);
  });

  it('returns required summary and source fields from non-stream generation', async () => {
    const { app } = createRouteApp({
      OPENAI_MODEL: 'gpt-test-model',
    });
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'add a welcome screen',
        currentSource: '',
        chatHistory: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      model: 'gpt-test-model',
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
      temperature: 0.4,
    });
  });

  it('matches the baseline non-stream response payload', async () => {
    const { app } = createRouteApp({
      OPENAI_MODEL: 'gpt-test-model',
    });
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'add a welcome screen',
        currentSource: '',
        chatHistory: [],
      }),
    });

    expect({
      payload: await response.json(),
      status: response.status,
    }).toMatchInlineSnapshot(`
      {
        "payload": {
          "appMemory": {
            "appSummary": "Test app",
            "avoid": [],
            "userPreferences": [
              "Keep the test UI compact.",
            ],
            "version": 1,
          },
          "changeSummary": "Test generation change.",
          "model": "gpt-test-model",
          "qualityIssues": [],
          "source": "root = AppShell([])",
          "summary": "Builds a tiny app.",
          "temperature": 0.4,
        },
        "status": 200,
      }
    `);
  });

  it('emits an error SSE event when the backend stream hits the output limit', async () => {
    const { app } = createRouteApp();
    streamOpenUiSourceMock.mockRejectedValue(
      new UpstreamFailureError('Streamed model output exceeded the backend limit of 100000 bytes.'),
    );

    const response = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'overflow the stream',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(events).toEqual([
      {
        event: 'error',
        data: '{"code":"upstream_error","error":"The model service could not complete the request.","status":502}',
      },
    ]);
  });

  it('emits chunk events before the error event when final stream validation fails after partial output', async () => {
    const { app } = createRouteApp();
    streamOpenUiSourceMock.mockImplementation(async (_env, _request, onTextDelta) => {
      await onTextDelta('{"summary":"","source":"root = ');
      await onTextDelta('AppShell([])"}');
      throw new UpstreamFailureError('Model output size 100001 bytes exceeded the backend limit of 100000 bytes.');
    });

    const response = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'overflow the extracted source after streaming chunks',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(events).toEqual([
      {
        event: 'chunk',
        data: '{"summary":"","source":"root = ',
      },
      {
        event: 'chunk',
        data: 'AppShell([])"}',
      },
      {
        event: 'error',
        data: '{"code":"upstream_error","error":"The model service could not complete the request.","status":502}',
      },
    ]);
  });

  it('emits an error SSE event when the backend stream times out', async () => {
    const { app } = createRouteApp();
    const timeoutError = new Error('Timed out while waiting for the model.');
    timeoutError.name = 'TimeoutError';
    streamOpenUiSourceMock.mockRejectedValue(timeoutError);

    const response = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'timeout the stream',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(events).toEqual([
      {
        event: 'error',
        data: '{"code":"timeout_error","error":"The model request timed out.","status":504}',
      },
    ]);
  });

  it('accepts client commit telemetry only after a successful generation request id', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const generationResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        prompt: 'generate a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });

    const response = await app.request('/api/llm/commit-telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        requestId: 'builder-request-parent',
        qualityWarnings: ['quality-unrequested-theme'],
        validationIssues: [],
        committed: true,
        commitSource: 'streaming',
        repairOutcome: 'fixed',
      }),
    });

    expect(generationResponse.status).toBe(200);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    expect(writePromptIoCommitTelemetrySafelyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        commitSource: 'streaming',
        committed: true,
        parentRequestId: 'builder-request-parent',
        qualityWarnings: ['quality-unrequested-theme'],
        repairOutcome: 'fixed',
        requestId: expect.any(String),
        validationIssues: [],
      }),
    );
  });

  it('accepts a failed repair outcome in client commit telemetry', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const generationResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        prompt: 'generate a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });

    const response = await app.request('/api/llm/commit-telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        requestId: 'builder-request-parent',
        validationIssues: ['reserved-last-choice-outside-action-mode'],
        committed: false,
        commitSource: 'streaming',
        repairOutcome: 'failed',
      }),
    });

    expect(generationResponse.status).toBe(200);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    expect(writePromptIoCommitTelemetrySafelyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        commitSource: 'streaming',
        committed: false,
        parentRequestId: 'builder-request-parent',
        qualityWarnings: [],
        repairOutcome: 'failed',
        requestId: expect.any(String),
        validationIssues: ['reserved-last-choice-outside-action-mode'],
      }),
    );
  });

  it('rejects commit telemetry when there was no completed generation request to match it', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/commit-telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        requestId: 'builder-request-parent',
        validationIssues: [],
        committed: true,
        commitSource: 'streaming',
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Commit telemetry request does not match a completed generation request.',
      status: 409,
    });
    expect(writePromptIoCommitTelemetrySafelyMock).not.toHaveBeenCalled();
    expect(writePromptIoIntakeFailureSafelyMock).not.toHaveBeenCalled();
  });

  it('rejects commit telemetry without a generation request id before parsing the body', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/commit-telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"requestId":',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Commit telemetry request does not match a completed generation request.',
      status: 409,
    });
    expect(writePromptIoCommitTelemetrySafelyMock).not.toHaveBeenCalled();
    expect(writePromptIoIntakeFailureSafelyMock).not.toHaveBeenCalled();
  });

  it('ignores spoofed forwarding headers when matching commit telemetry to generation requests', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const generationResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.10',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        prompt: 'generate a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });

    const response = await app.request('/api/llm/commit-telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.11',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        requestId: 'builder-request-parent',
        validationIssues: [],
        committed: true,
        commitSource: 'streaming',
      }),
    });

    expect(generationResponse.status).toBe(200);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    expect(writePromptIoCommitTelemetrySafelyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        committed: true,
        parentRequestId: 'builder-request-parent',
        requestId: expect.any(String),
      }),
    );
  });

  it('rejects commit telemetry when the body request id does not match the generation request header', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const generationResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        prompt: 'generate a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const response = await app.request('/api/llm/commit-telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        requestId: 'builder-request-other',
        validationIssues: [],
        committed: true,
        commitSource: 'streaming',
      }),
    });

    expect(generationResponse.status).toBe(200);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(writePromptIoCommitTelemetrySafelyMock).not.toHaveBeenCalled();
    expect(writePromptIoIntakeFailureSafelyMock).not.toHaveBeenCalled();
  });

  it('accepts at most three commit telemetry events per completed generation request', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const generationResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        prompt: 'generate a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });
    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        requestId: 'builder-request-parent',
        validationIssues: [],
        committed: true,
        commitSource: 'streaming',
      }),
    };

    const firstResponse = await app.request('/api/llm/commit-telemetry', requestInit);
    const secondResponse = await app.request('/api/llm/commit-telemetry', requestInit);
    const thirdResponse = await app.request('/api/llm/commit-telemetry', requestInit);
    const fourthResponse = await app.request('/api/llm/commit-telemetry', requestInit);

    expect(generationResponse.status).toBe(200);
    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(thirdResponse.status).toBe(202);
    expect(fourthResponse.status).toBe(409);
    expect(await fourthResponse.json()).toEqual({
      code: 'validation_error',
      error: 'Commit telemetry for this generation request was already accepted too many times.',
      status: 409,
    });
    expect(writePromptIoCommitTelemetrySafelyMock).toHaveBeenCalledTimes(3);
  });

  it('does not accept commit telemetry for aborted streams that never reached the done event', async () => {
    const { app } = createRouteApp();
    streamOpenUiSourceMock.mockImplementation(async (_env, _request, onTextDelta) => {
      await onTextDelta('root = ');
      throw new APIUserAbortError();
    });

    const streamResponse = await app.request('/api/llm/generate/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        prompt: 'abort the stream',
        currentSource: '',
        chatHistory: [],
      }),
    });

    const telemetryResponse = await app.request('/api/llm/commit-telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        requestId: 'builder-request-parent',
        validationIssues: [],
        committed: false,
        commitSource: 'streaming',
      }),
    });

    expect(streamResponse.status).toBe(200);
    expect(parseSseEvents(await streamResponse.text())).toEqual([{ event: 'chunk', data: 'root = ' }]);
    expect(telemetryResponse.status).toBe(409);
    expect(await telemetryResponse.json()).toEqual({
      code: 'validation_error',
      error: 'Commit telemetry request does not match a completed generation request.',
      status: 409,
    });
    expect(writePromptIoCommitTelemetrySafelyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid commit telemetry payloads without writing intake failures', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
      changeSummary: 'Test generation change.',
      appMemory: testAppMemory,
    });

    const generationResponse = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        prompt: 'generate a tiny app',
        currentSource: '',
        chatHistory: [],
      }),
    });

    const response = await app.request('/api/llm/commit-telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kitto-request-id': 'builder-request-parent',
      },
      body: JSON.stringify({
        committed: true,
        commitSource: 'streaming',
      }),
    });

    expect(generationResponse.status).toBe(200);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'The request payload is invalid.',
      status: 400,
    });
    expect(writePromptIoCommitTelemetrySafelyMock).not.toHaveBeenCalled();
    expect(writePromptIoIntakeFailureSafelyMock).not.toHaveBeenCalled();
  });
});
