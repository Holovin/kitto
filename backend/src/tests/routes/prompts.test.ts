import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { getPromptInfoSnapshot, getPromptToolSpecSummaries } from '../../prompts/openui.js';
import { createTestEnv } from '../createTestEnv.js';

describe('GET /api/prompts/info', () => {
  it('returns the prompt info snapshot with public CORS headers', async () => {
    const env = createTestEnv({
      FRONTEND_ORIGIN: 'https://builder.kitto.test',
      LLM_OUTPUT_MAX_BYTES: 120_000,
      LLM_REQUEST_MAX_BYTES: 345_678,
      OPENAI_MODEL: 'gpt-5.4-mini',
    });
    const app = createApp(env);

    const response = await app.request('/api/prompts/info', {
      headers: {
        Origin: 'https://builder.kitto.test',
      },
    });
    const payload = (await response.json()) as ReturnType<typeof getPromptInfoSnapshot>;

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://builder.kitto.test');
    expect(payload.config).toEqual({
      cacheKeyPrefix: 'kitto:openui',
      maxOutputTokens: 30_000,
      model: 'gpt-5.4-mini',
      outputMaxBytes: 120_000,
      requestMaxBytes: 345_678,
      structuredOutput: true,
      temperature: 0.6,
    });
    expect(payload.systemPrompt.hash).toHaveLength(16);
    expect(payload.systemPrompt.text.length).toBeGreaterThan(1_000);
    expect(payload.userPromptTemplate).toContain('<user_request>');
    expect(payload.userPromptTemplate).toContain('<current_source>');
    expect(payload.userPromptTemplate).toContain('<recent_history>');
    expect(payload.repairPromptTemplate).toContain('Current critical syntax rules:');
    expect(payload.toolSpecs).toEqual(getPromptToolSpecSummaries());
    expect(payload.envelopeSchema).toEqual({
      additionalProperties: false,
      properties: {
        notes: {
          items: {
            maxLength: 200,
            type: 'string',
          },
          maxItems: 5,
          type: 'array',
        },
        source: {
          type: 'string',
        },
        summary: {
          maxLength: 200,
          type: 'string',
        },
      },
      required: ['summary', 'source', 'notes'],
      type: 'object',
    });
  });

  it('matches the memoized prompt snapshot helper for the active environment', async () => {
    const env = createTestEnv({
      LLM_STRUCTURED_OUTPUT: false,
    });
    const app = createApp(env);

    const response = await app.request('/api/prompts/info');
    const payload = (await response.json()) as ReturnType<typeof getPromptInfoSnapshot>;

    expect(response.status).toBe(200);
    expect(payload).toEqual(getPromptInfoSnapshot(env));
    expect(payload.config.structuredOutput).toBe(false);
  });
});
