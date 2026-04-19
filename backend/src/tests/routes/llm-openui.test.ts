import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestEnv } from '../createTestEnv.js';

vi.mock(import('../../services/openai.js'), () => ({
  generateOpenUiSource: vi.fn(),
  streamOpenUiSource: vi.fn(),
}));

import { generateOpenUiSource, streamOpenUiSource } from '../../services/openai.js';
import { createLlmOpenUiRoutes } from '../../routes/llm-openui.js';

const generateOpenUiSourceMock = vi.mocked(generateOpenUiSource);
const streamOpenUiSourceMock = vi.mocked(streamOpenUiSource);

function createRouteApp(envOverrides: Parameters<typeof createTestEnv>[0] = {}) {
  const env = createTestEnv(envOverrides);
  const app = new Hono();
  app.route('/api', createLlmOpenUiRoutes(env));

  return { app, env };
}

function parseSseEvents(payload: string) {
  return payload
    .trim()
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
      error: 'Request body is too large to process safely.',
      status: 400,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
  });

  it('rejects oversized raw bodies before parsing or calling the OpenAI service', async () => {
    const { app } = createRouteApp({
      LLM_REQUEST_MAX_BYTES: 20,
    });
    const oversizedBody = JSON.stringify({
      prompt: 'x'.repeat(60),
      currentSource: '',
      chatHistory: [],
    });

    const response = await app.request('/api/llm/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: oversizedBody,
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      code: 'validation_error',
      error: 'Request body is too large to process safely.',
      status: 413,
    });
    expect(generateOpenUiSourceMock).not.toHaveBeenCalled();
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
    generateOpenUiSourceMock.mockResolvedValue('root = AppShell([])');

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
      source: 'root = AppShell([])',
    });
    expect(calledEnv).toBe(env);
    expect(calledRequest).toEqual({
      prompt: 'build a compact app',
      currentSource: '',
      chatHistory: chatHistory.slice(-2),
    });
    expect(calledSignal).toBeInstanceOf(AbortSignal);
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
    generateOpenUiSourceMock.mockResolvedValue('root = AppShell([])');

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
      source: 'root = AppShell([])',
    });
  });

  it('streams chunk and done SSE events without calling the real OpenAI client', async () => {
    const { app, env } = createRouteApp({
      OPENAI_MODEL: 'gpt-stream-model',
    });
    streamOpenUiSourceMock.mockImplementation(async (_env, _request, onTextDelta) => {
      await onTextDelta('root = ');
      await onTextDelta('AppShell([])');
      return 'root = AppShell([])';
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
    const [calledEnv, calledRequest, , calledSignal] = streamOpenUiSourceMock.mock.calls[0] ?? [];

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(calledEnv).toBe(env);
    expect(calledRequest).toEqual({
      prompt: 'stream a tiny app',
      currentSource: '',
      chatHistory: [],
    });
    expect(calledSignal).toBeInstanceOf(AbortSignal);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ event: 'chunk', data: 'root = ' });
    expect(events[1]).toEqual({ event: 'chunk', data: 'AppShell([])' });
    expect(events[2]?.event).toBe('done');
    expect(JSON.parse(events[2]?.data ?? '{}')).toEqual({
      model: 'gpt-stream-model',
      source: 'root = AppShell([])',
    });
  });
});
