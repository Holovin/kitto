import { describe, expect, it } from 'vitest';
import {
  getBuilderGenerationConfig,
  getBuilderMaxRepairAttempts,
  getBuilderMaxRepairValidationIssues,
  getApproximateBuilderRequestSizeBytes,
  getBuilderRequestLimits,
  getBuilderRuntimeConfigStatus,
  getBuilderSanitizedLlmRequestForTransport,
  getBuilderStreamTimeouts,
  type BuilderRequestLimits,
  validateBuilderLlmRequest,
} from '@pages/Chat/builder/config';
import type { BuilderConfigResponse, PromptBuildRequest } from '@pages/Chat/builder/types';

const TEST_LIMITS: BuilderRequestLimits = {
  chatMessageMaxChars: 4_096,
  chatHistoryMaxItems: 40,
  promptMaxChars: 4_096,
  requestMaxBytes: 300_000,
  sourceMaxChars: 12_288,
};
const TEST_CONFIG: BuilderConfigResponse = {
  generation: {
    repairTemperature: 0.2,
    temperature: 0.4,
  },
  limits: TEST_LIMITS,
  repair: {
    maxRepairAttempts: 3,
    maxValidationIssues: 20,
  },
  timeouts: {
    streamIdleTimeoutMs: 45_000,
    streamMaxDurationMs: 120_000,
  },
};

function createRequest(overrides: Partial<PromptBuildRequest> = {}): PromptBuildRequest {
  return {
    prompt: 'Build a small app',
    currentSource: '',
    chatHistory: [],
    mode: 'initial',
    ...overrides,
  };
}

describe('builder request preflight', () => {
  it('stays unresolved until /api/config has loaded', () => {
    expect(getBuilderGenerationConfig()).toBeNull();
    expect(getBuilderMaxRepairAttempts()).toBeNull();
    expect(getBuilderRequestLimits()).toBeNull();
    expect(getBuilderStreamTimeouts()).toBeNull();
    expect(getBuilderRuntimeConfigStatus({})).toBe('loading');
  });

  it('resolves runtime config only from /api/config data', () => {
    expect(getBuilderGenerationConfig(TEST_CONFIG)).toEqual(TEST_CONFIG.generation);
    expect(getBuilderMaxRepairAttempts(TEST_CONFIG)).toBe(3);
    expect(getBuilderMaxRepairValidationIssues(TEST_CONFIG)).toBe(20);
    expect(getBuilderRequestLimits(TEST_CONFIG)).toEqual(TEST_LIMITS);
    expect(getBuilderStreamTimeouts(TEST_CONFIG)).toEqual(TEST_CONFIG.timeouts);
    expect(getBuilderRuntimeConfigStatus({ data: TEST_CONFIG })).toBe('loaded');
  });

  it('reports a failed runtime-config state when no usable config is available', () => {
    expect(getBuilderRuntimeConfigStatus({ isError: true })).toBe('failed');
    expect(
      getBuilderRuntimeConfigStatus({
        data: {
          ...TEST_CONFIG,
          limits: {
            ...TEST_LIMITS,
            promptMaxChars: 0,
          },
        } as BuilderConfigResponse,
      }),
    ).toBe('failed');
  });

  it('measures approximate request bytes from the serialized payload', () => {
    const request = createRequest({
      currentSource: '🙂',
      chatHistory: [{ role: 'user', content: 'привет' }],
    });

    expect(getApproximateBuilderRequestSizeBytes(request)).toBe(new TextEncoder().encode(JSON.stringify(request)).byteLength);
  });

  it('returns a prompt-size validation error before checking payload bytes', () => {
    const request = createRequest({
      prompt: 'x'.repeat(32),
      currentSource: 'y'.repeat(10_000),
    });

    expect(
      validateBuilderLlmRequest(request, {
        ...TEST_LIMITS,
        promptMaxChars: 8,
        requestMaxBytes: 64,
      }),
    ).toBe('Prompt is too large. Limit: 8 characters.');
  });

  it('returns a controlled error when the serialized payload exceeds the request byte limit', () => {
    const request = createRequest({
      currentSource: 'x'.repeat(1_024),
    });

    expect(
      validateBuilderLlmRequest(request, {
        ...TEST_LIMITS,
        requestMaxBytes: 128,
      }),
    ).toBe(
      'The request is too large to send as-is. Limit: 128 bytes for the full request payload. Shorten the prompt or reduce recent context and try again.',
    );
  });

  it('returns a current-source validation error before checking payload bytes', () => {
    const request = createRequest({
      currentSource: 'x'.repeat(32),
    });

    expect(
      validateBuilderLlmRequest(request, {
        ...TEST_LIMITS,
        requestMaxBytes: 64,
        sourceMaxChars: 8,
      }),
    ).toBe(
      'The current app definition is too large to safely modify in one request. Export the definition or simplify/reset the app before continuing.',
    );
  });

  it('returns an invalid-draft validation error before checking payload bytes', () => {
    const request = createRequest({
      invalidDraft: 'x'.repeat(32),
      mode: 'repair',
    });

    expect(
      validateBuilderLlmRequest(request, {
        ...TEST_LIMITS,
        requestMaxBytes: 64,
        sourceMaxChars: 8,
      }),
    ).toBe('Invalid draft is too large. Limit: 8 characters.');
  });

  it('returns a chat-history message validation error before checking payload bytes', () => {
    const request = createRequest({
      chatHistory: [{ role: 'user', content: 'x'.repeat(32) }],
    });

    expect(
      validateBuilderLlmRequest(request, {
        ...TEST_LIMITS,
        chatMessageMaxChars: 8,
        requestMaxBytes: 64,
      }),
    ).toBe('Chat history message is too large. Limit: 8 characters.');
  });

  it('preserves the first user request while compacting recent context by item limit', () => {
    const request = createRequest({
      chatHistory: [
        { role: 'user', content: 'Build a todo app' },
        { role: 'assistant', content: 'Built the initial todo app.' },
        { role: 'user', content: 'Add filters' },
        { role: 'assistant', content: 'Added filters.' },
        { role: 'user', content: 'Add sorting' },
        { role: 'assistant', content: 'Added sorting.' },
      ],
    });

    expect(
      getBuilderSanitizedLlmRequestForTransport(request, {
        ...TEST_LIMITS,
        chatHistoryMaxItems: 4,
      }),
    ).toEqual({
      ...request,
      chatHistory: [
        { role: 'user', content: 'Build a todo app' },
        { role: 'user', content: 'Add filters' },
        { role: 'user', content: 'Add sorting' },
        { role: 'assistant', content: 'Added sorting.' },
      ],
    });
  });

  it('uses turn-aware byte compaction for the transport request', () => {
    const request = createRequest({
      chatHistory: [
        { role: 'user', content: 'Build a catalog app ' + 'a'.repeat(48) },
        { role: 'assistant', content: 'Built the initial catalog app. ' + 'b'.repeat(96) },
        { role: 'user', content: 'Add filters ' + 'c'.repeat(48) },
        { role: 'assistant', content: 'Added filters and preserved the layout. ' + 'd'.repeat(96) },
      ],
    });
    const expectedChatHistory = [request.chatHistory[0], request.chatHistory[2]];
    const requestMaxBytes = getApproximateBuilderRequestSizeBytes({
      ...request,
      chatHistory: expectedChatHistory,
    });

    expect(
      getBuilderSanitizedLlmRequestForTransport(request, {
        ...TEST_LIMITS,
        requestMaxBytes,
      }),
    ).toEqual({
      ...request,
      chatHistory: expectedChatHistory,
    });
  });

  it('allows requests that stay within both prompt and byte limits', () => {
    expect(validateBuilderLlmRequest(createRequest(), TEST_LIMITS)).toBeNull();
  });
});
