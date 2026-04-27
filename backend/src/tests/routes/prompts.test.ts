import { describe, expect, it } from 'vitest';
import { createApp } from '#backend/app.js';
import { getPromptInfoSnapshot, getPromptToolSpecSummaries } from '#backend/prompts/openui.js';
import { createTestEnv } from '#backend/tests/createTestEnv.js';

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
    const todoIntentContextVariant = payload.intentContextVariants.find((variant) => variant.id === 'todo');

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://builder.kitto.test');
    expect(payload.config).toEqual({
      cacheKeyPrefix: 'kitto:openui',
      maxOutputTokens: 30_000,
      model: 'gpt-5.4-mini',
      modelPromptMaxChars: 16_384,
      outputMaxBytes: 120_000,
      repairTemperature: 0.2,
      requestMaxBytes: 345_678,
      temperature: 0.4,
      userPromptMaxChars: 4_096,
    });
    expect(payload.systemPrompt).toEqual(payload.systemPromptVariants[0]);
    expect(payload.systemPrompt.id).toBe('base');
    expect(payload.systemPrompt.intentVector).toBe('base');
    expect(payload.systemPrompt.hash).toHaveLength(16);
    expect(payload.systemPrompt.cacheKey).toMatch(/^kitto:openui:base:[a-f0-9]{12}$/);
    expect(payload.systemPrompt.text.length).toBeGreaterThan(1_000);
    expect(payload.systemPromptVariants.map((variant) => variant.id)).toEqual(['base']);
    expect(payload.intentContext).toEqual(payload.intentContextVariants[0]);
    expect(payload.intentContextVariants.map((variant) => variant.id)).toEqual([
      'base',
      'todo',
      'theme',
      'control-showcase',
      'filtering',
      'validation',
      'compute',
      'random',
      'delete',
      'multi-screen',
    ]);
    expect(todoIntentContextVariant).toMatchObject({
      id: 'todo',
      intentVector: 't',
      label: 'Todo',
      sampleRequest: 'Create a todo list.',
    });
    expect(todoIntentContextVariant?.text).toContain('Todo/task list pattern:');
    expect(todoIntentContextVariant?.text).toContain('Checkbox("toggle-" + item.id');
    expect(payload.requestPromptTemplate).toContain('Initial generation input shape:');
    expect(payload.requestPromptTemplate).toContain('Final user turn request/source block sent after the intent-context separator:');
    expect(payload.requestPromptTemplate).toContain('each sent as its own role-based message');
    expect(payload.requestPromptTemplate).toContain('<intent_context>');
    expect(payload.requestPromptTemplate).toContain('<request_intent>');
    expect(payload.requestPromptTemplate).toContain('This request appears to be: [operation], [screen flow], [scope], [detected feature hints].');
    expect(payload.requestPromptTemplate).toContain('<latest_user_request>');
    expect(payload.requestPromptTemplate).toContain('<current_source_inventory>');
    expect(payload.requestPromptTemplate).toContain('optional `<conversation_context>`');
    expect(payload.requestPromptTemplate).toContain('<current_source>');
    expect(payload.requestPromptTemplate).toContain('<assistant_summary>');
    expect(payload.requestPromptTemplate).toContain(
      'The `summary` MUST describe the visible app/change in one complete user-facing sentence under 200 characters.',
    );
    expect(payload.requestPromptTemplate).toContain(
      'Bad: "Updated the app." Good: "Added a required email field with inline validation to the signup form."',
    );
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
