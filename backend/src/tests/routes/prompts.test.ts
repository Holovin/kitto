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
    const todoSystemPromptVariant = payload.systemPromptVariants.find((variant) => variant.id === 'todo');

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://builder.kitto.test');
    expect(payload.config).toEqual({
      cacheKeyPrefix: 'kitto:openui',
      maxOutputTokens: 30_000,
      model: 'gpt-5.4-mini',
      modelPromptMaxChars: 12_288,
      outputMaxBytes: 120_000,
      repairTemperature: 0.2,
      requestMaxBytes: 345_678,
      temperature: 0.6,
      userPromptMaxChars: 4_096,
    });
    expect(payload.systemPrompt).toEqual(payload.systemPromptVariants[0]);
    expect(payload.systemPrompt.id).toBe('base');
    expect(payload.systemPrompt.intentVector).toBe('base');
    expect(payload.systemPrompt.hash).toHaveLength(16);
    expect(payload.systemPrompt.cacheKey).toMatch(/^kitto:openui:base:[a-f0-9]{12}:[a-f0-9]{16}$/);
    expect(payload.systemPrompt.text.length).toBeGreaterThan(1_000);
    expect(payload.systemPromptVariants.map((variant) => variant.id)).toEqual([
      'base',
      'todo',
      'theme',
      'filtering',
      'validation',
      'compute',
      'random',
      'multi-screen',
    ]);
    expect(todoSystemPromptVariant).toMatchObject({
      id: 'todo',
      intentVector: 't',
      label: 'Todo',
      sampleRequest: 'Create a todo list.',
    });
    expect(todoSystemPromptVariant?.cacheKey).toMatch(/^kitto:openui:t:[a-f0-9]{12}:[a-f0-9]{16}$/);
    expect(todoSystemPromptVariant?.text).toContain('Display-only `Checkbox(item.completed)` does not write back to persisted collections by itself.');
    expect(todoSystemPromptVariant?.hash).not.toBe(payload.systemPrompt.hash);
    expect(payload.requestPromptTemplate).toContain('Initial generation input shape:');
    expect(payload.requestPromptTemplate).toContain('Final user turn sent to the model:');
    expect(payload.requestPromptTemplate).toContain('each sent as its own role-based message');
    expect(payload.requestPromptTemplate).toContain('<request_intent>');
    expect(payload.requestPromptTemplate).toContain('operation: create|modify|repair|unknown');
    expect(payload.requestPromptTemplate).toContain('minimality: simple|normal');
    expect(payload.requestPromptTemplate).toContain('<latest_user_request>');
    expect(payload.requestPromptTemplate).toContain('<current_source_inventory>');
    expect(payload.requestPromptTemplate).toContain('queries: [queryName -&gt; tool(path), or none]');
    expect(payload.requestPromptTemplate).toContain('<current_source>');
    expect(payload.requestPromptTemplate).toContain('<assistant_summary>');
    expect(payload.requestPromptTemplate).toContain('The `summary` MUST describe the visible app/change in 1-2 short user-facing sentences.');
    expect(payload.requestPromptTemplate).toContain('Bad summary: "Updated the app." Good summary:');
    expect(payload.requestPromptTemplate).toContain('- Summary must describe the specific change made to the existing app.');
    expect(payload.repairPromptTemplate).toContain('Parser-only repair example');
    expect(payload.repairPromptTemplate).toContain('Quality-only repair example');
    expect(payload.repairPromptTemplate).toContain('Mixed repair example');
    expect(payload.repairPromptTemplate).toContain('Current critical syntax rules:');
    expect(payload.repairPromptTemplate).toContain('Place the full corrected OpenUI Lang program in `source`.');
    expect(payload.toolSpecs).toEqual(getPromptToolSpecSummaries());
    expect(payload.envelopeSchema).toEqual({
      additionalProperties: false,
      properties: {
        source: {
          minLength: 1,
          type: 'string',
        },
        summary: {
          maxLength: 200,
          type: 'string',
        },
      },
      required: ['summary', 'source'],
      type: 'object',
    });
  });

  it('matches the memoized prompt snapshot helper for the active environment', async () => {
    const env = createTestEnv();
    const app = createApp(env);

    const response = await app.request('/api/prompts/info');
    const payload = (await response.json()) as ReturnType<typeof getPromptInfoSnapshot>;

    expect(response.status).toBe(200);
    expect(payload).toEqual(getPromptInfoSnapshot(env));
    expect(payload.requestPromptTemplate).toContain('Place the full updated OpenUI Lang program in `source`.');
    expect(payload.repairPromptTemplate).toContain('Place the full corrected OpenUI Lang program in `source`.');
  });
});
