import { describe, expect, it } from 'vitest';
import {
  getApproximateBuilderRequestSizeBytes,
  type BuilderRequestLimits,
  validateBuilderLlmRequest,
} from '@features/builder/config';
import type { BuilderLlmRequest } from '@features/builder/types';

const DEFAULT_LIMITS: BuilderRequestLimits = {
  chatHistoryMaxItems: 40,
  promptMaxChars: 4_096,
  requestMaxBytes: 300_000,
};

function createRequest(overrides: Partial<BuilderLlmRequest> = {}): BuilderLlmRequest {
  return {
    prompt: 'Build a small app',
    currentSource: '',
    chatHistory: [],
    mode: 'initial',
    ...overrides,
  };
}

describe('builder request preflight', () => {
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
        ...DEFAULT_LIMITS,
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
        ...DEFAULT_LIMITS,
        requestMaxBytes: 128,
      }),
    ).toBe(
      'The request is too large to send as-is. Limit: 128 bytes for the full request payload. Shorten the prompt or reduce recent context and try again.',
    );
  });

  it('allows requests that stay within both prompt and byte limits', () => {
    expect(validateBuilderLlmRequest(createRequest(), DEFAULT_LIMITS)).toBeNull();
  });
});
