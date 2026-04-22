import { APIError, APIUserAbortError } from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { UpstreamFailureError } from '../../errors/publicError.js';
import { createTestEnv } from '../createTestEnv.js';

const {
  writePromptIoCommitTelemetrySafelyMock,
  writePromptIoIntakeFailureSafelyMock,
} = vi.hoisted(() => ({
  writePromptIoCommitTelemetrySafelyMock: vi.fn(),
  writePromptIoIntakeFailureSafelyMock: vi.fn(),
}));

vi.mock(import('../../services/openai.js'), () => ({
  generateOpenUiSource: vi.fn(),
  streamOpenUiSource: vi.fn(),
}));

vi.mock(import('../../services/openai/logging.js'), () => ({
  writePromptIoCommitTelemetrySafely: writePromptIoCommitTelemetrySafelyMock,
  writePromptIoIntakeFailureSafely: writePromptIoIntakeFailureSafelyMock,
}));

import { generateOpenUiSource, streamOpenUiSource } from '../../services/openai.js';
import { getRawRequestMaxBytes } from '../../limits.js';

const generateOpenUiSourceMock = vi.mocked(generateOpenUiSource);
const streamOpenUiSourceMock = vi.mocked(streamOpenUiSource);
const textEncoder = new TextEncoder();
const unresolvedReferenceIssue = {
  code: 'unresolved-reference',
  message: 'This statement was referenced but never defined in the final source.',
  source: 'parser' as const,
  statementId: 'items',
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
      LLM_PROMPT_MAX_CHARS: 8,
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
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '' });

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

  it('compacts chat history by item limit before generation', async () => {
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
    });
    expect(calledEnv).toBe(env);
    expect(calledRequest).toEqual({
      prompt: 'build a compact app',
      currentSource: '',
      mode: 'initial',
      chatHistory: chatHistory.slice(-2),
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
    });
    expect(calledRequest).toEqual({
      prompt: 'build a compact app',
      currentSource: '',
      mode: 'initial',
      chatHistory: [
        { role: 'assistant', content: 'recent assistant reply' },
        { role: 'user', content: 'most recent user message' },
      ],
    });
  });

  it('filters excludeFromLlmContext and legacy assistant summaries before compaction and generation', async () => {
    const { app } = createRouteApp({
      LLM_CHAT_HISTORY_MAX_ITEMS: 5,
    });
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '' });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'build a compact app',
        currentSource: '',
        chatHistory: [
          { role: 'assistant', content: 'Updated the app definition from the latest chat instruction.' },
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

  it('passes through explicit repair mode to the OpenAI service request', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '' });

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
    expect(calledRequest).toEqual({
      prompt: 'repair this invalid app',
      currentSource: 'root = AppShell([])',
      mode: 'repair',
      invalidDraft: 'root = AppShell([Button("broken", "Broken", "default")])',
      chatHistory: [],
    });
  });

  it('passes parentRequestId and validationIssues through to the OpenAI service request', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '' });

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
        validationIssues: [unresolvedReferenceIssue],
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
      validationIssues: [unresolvedReferenceIssue],
      chatHistory: [],
    });
  });

  it('passes x-kitto-request-id through to the non-stream OpenAI service call', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '' });

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

  it('compacts oversized requests by bytes while keeping the newest chat messages', async () => {
    const { app } = createRouteApp({
      LLM_REQUEST_MAX_BYTES: 260,
    });
    const chatHistory = [
      { role: 'user' as const, content: 'a'.repeat(120) },
      { role: 'assistant' as const, content: 'b'.repeat(120) },
      { role: 'user' as const, content: 'c'.repeat(120) },
    ];
    generateOpenUiSourceMock.mockResolvedValue({ source: 'root = AppShell([])', summary: '' });

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
    expect(calledRequest.chatHistory).toEqual(chatHistory.slice(-calledRequest.chatHistory.length));
    expect(payload).toEqual({
      compaction: {
        compactedByBytes: true,
        compactedByItemLimit: false,
        omittedChatMessages: chatHistory.length - calledRequest.chatHistory.length,
      },
      model: 'gpt-5.4-mini',
      qualityIssues: [],
      source: 'root = AppShell([])',
      summary: '',
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
              "model": "gpt-stream-model",
              "qualityIssues": [],
              "source": "root = AppShell([])",
              "summary": "Builds a tiny app.",
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
    });
  });

  it('passes x-kitto-request-id through to the streaming OpenAI service call', async () => {
    const { app } = createRouteApp();
    streamOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
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
      summary: 'Adds a welcome screen.',
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
      summary: 'Adds a welcome screen.',
    });
  });

  it('matches the baseline non-stream response payload', async () => {
    const { app } = createRouteApp({
      OPENAI_MODEL: 'gpt-test-model',
    });
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Adds a welcome screen.',
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
          "model": "gpt-test-model",
          "qualityIssues": [],
          "source": "root = AppShell([])",
          "summary": "Adds a welcome screen.",
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

  it('accepts client commit telemetry only after a successful generation request from the same client', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
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
        'x-forwarded-for': '203.0.113.10',
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
        commitSource: 'streaming',
        committed: true,
        parentRequestId: 'builder-request-parent',
        requestId: expect.any(String),
        validationIssues: [],
      }),
    );
  });

  it('rejects commit telemetry when there was no completed generation request to match it', async () => {
    const { app } = createRouteApp();

    const response = await app.request('/api/llm/commit-telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

  it('rejects commit telemetry from a different client even when the request id exists', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
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
      },
      body: JSON.stringify({
        requestId: 'builder-request-parent',
        validationIssues: [],
        committed: true,
        commitSource: 'streaming',
      }),
    });

    expect(generationResponse.status).toBe(200);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Commit telemetry request does not match a completed generation request.',
      status: 409,
    });
    expect(writePromptIoCommitTelemetrySafelyMock).not.toHaveBeenCalled();
  });

  it('accepts at most three commit telemetry events per completed generation request', async () => {
    const { app } = createRouteApp();
    generateOpenUiSourceMock.mockResolvedValue({
      source: 'root = AppShell([])',
      summary: 'Builds a tiny app.',
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
    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.10',
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
        'x-forwarded-for': '203.0.113.10',
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
        'x-forwarded-for': '203.0.113.10',
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

    const response = await app.request('/api/llm/commit-telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        committed: true,
        commitSource: 'streaming',
      }),
    });

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
