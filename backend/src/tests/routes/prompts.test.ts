import { describe, expect, it } from 'vitest';
import { createApp } from '#backend/app.js';
import { getPromptInfoSnapshot, getPromptToolSpecSummaries } from '#backend/prompts/openui.js';
import { createTestEnv } from '#backend/tests/createTestEnv.js';

describe('GET /api/prompts/info', () => {
  it('returns the prompt info snapshot with public CORS headers', async () => {
    const env = createTestEnv({
      frontendOrigin: 'https://builder.kitto.test',
      outputMaxBytes: 120_000,
      requestMaxBytes: 345_678,
      openAiModel: 'gpt-5.4-mini',
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
      currentSourceEmergencyMaxChars: 80_000,
      maxRepairAttempts: 2,
      maxOutputTokens: 30_000,
      model: 'gpt-5.4-mini',
      modelPromptMaxChars: 180_000,
      outputMaxBytes: 120_000,
      repairTemperature: 0.2,
      requestMaxBytes: 345_678,
      temperature: 0.4,
      userPromptMaxChars: 4_096,
    });
    expect(payload.systemPrompt).toEqual(payload.systemPromptVariants[0]);
    expect(payload.promptContextLimits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hardLimitChars: 4_096,
          name: 'latestUserPrompt',
          protected: true,
        }),
        expect.objectContaining({
          hardLimitChars: 80_000,
          name: 'currentSource',
          protected: true,
        }),
        expect.objectContaining({
          hardLimitChars: 20_000,
          name: 'previousUserMessages',
          protected: false,
          softLimitChars: 4_096,
        }),
        expect.objectContaining({
          hardLimitChars: 20_000,
          name: 'previousChangeSummaries',
          protected: false,
          softLimitChars: 1_024,
        }),
      ]),
    );
    expect(payload.systemPrompt.id).toBe('base');
    expect(payload.systemPrompt.intentVector).toBe('base');
    expect(payload.systemPrompt.hash).toHaveLength(16);
    expect(payload.systemPrompt.cacheKey).toMatch(/^kitto:openui:base:[a-f0-9]{12}$/);
    expect(payload.systemPrompt.text.length).toBeGreaterThan(1_000);
    expect(payload.systemPromptVariants.map((variant) => variant.id)).toEqual([
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
    expect(payload.systemPromptVariants.find((variant) => variant.id === 'todo')).toMatchObject({
      id: 'todo',
      intentVector: 't',
      label: 'Todo',
      sampleRequest: 'Create a todo list.',
    });
    expect(payload.systemPromptVariants.find((variant) => variant.id === 'todo')?.cacheKey).toMatch(
      /^kitto:openui:t:[a-f0-9]{12}$/,
    );
    expect(payload.systemPromptVariants.find((variant) => variant.id === 'theme')?.cacheKey).toMatch(
      /^kitto:openui:th:[a-f0-9]{12}$/,
    );
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
    expect(payload.requestPromptTemplate).toContain('<intent_context>');
    expect(payload.requestPromptTemplate).toContain('<request_intent>');
    expect(payload.requestPromptTemplate).toContain('This request appears to be: [operation], [screen flow], [scope], [detected feature hints].');
    expect(payload.requestPromptTemplate).toContain('<latest_user_request>');
    expect(payload.requestPromptTemplate).toContain('protected `<current_source>`');
    expect(payload.requestPromptTemplate).toContain('optional `<conversation_context>`');
    expect(payload.requestPromptTemplate).toContain('<current_source>');
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
    expect(payload.staticPromptContextSections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          budgetLabel: '-',
          chars: expect.any(Number),
          content: expect.any(String),
          included: true,
          limitLabels: [
            'optional context target LLM_MODEL_PROMPT_MAX_CHARS 180000',
            'global LLM_REQUEST_MAX_BYTES 345678',
            'global LLM_OUTPUT_MAX_BYTES 120000',
          ],
          name: 'GLOBAL',
          priority: 0,
          protected: true,
        }),
        expect.objectContaining({
          chars: expect.any(Number),
          content: expect.any(String),
          included: true,
          name: 'structuredOutputContract',
          priority: 2,
          protected: true,
          unminifiedChars: expect.any(Number),
        }),
      ]),
    );
    const structuredOutputSection = payload.staticPromptContextSections.find((section) => section.name === 'structuredOutputContract');
    expect(structuredOutputSection?.unminifiedChars).toBeGreaterThan(structuredOutputSection?.chars ?? 0);
    expect(payload.toolSpecs).toEqual(getPromptToolSpecSummaries());
    expect(payload.envelopeSchema).toEqual({
      additionalProperties: false,
      properties: {
        appMemory: {
          additionalProperties: false,
          properties: {
            appSummary: {
              maxLength: 1800,
              type: 'string',
            },
            avoid: {
              items: {
                maxLength: 180,
                type: 'string',
              },
              maxItems: 8,
              type: 'array',
            },
            userPreferences: {
              items: {
                maxLength: 180,
                type: 'string',
              },
              maxItems: 8,
              type: 'array',
            },
            version: {
              const: 1,
              type: 'number',
            },
          },
          required: ['version', 'appSummary', 'userPreferences', 'avoid'],
          type: 'object',
        },
        changeSummary: {
          maxLength: 300,
          type: 'string',
        },
        source: {
          minLength: 1,
          type: 'string',
        },
        summary: {
          maxLength: 200,
          type: 'string',
        },
      },
      required: ['summary', 'changeSummary', 'source', 'appMemory'],
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
