import { describe, expect, it } from 'vitest';
import {
  buildContextMeterSections,
  buildStaticPromptInfoContextSections,
  formatContextMeterTooltip,
} from '@pages/Chat/builder/hooks/generationContext';
import type { PromptsInfoResponse } from '@pages/Chat/builder/types';

describe('generationContext', () => {
  it('marks current source as protected in the context meter', () => {
    const currentSource = 'root = AppShell([])';
    const sections = buildContextMeterSections({
      appMemory: {
        version: 1,
        appSummary: 'Test app',
        userPreferences: [],
        avoid: [],
      },
      currentSource,
      historySummary: 'Older context summary.',
      latestUserPrompt: 'Add a settings screen.',
      previousChangeSummaries: ['Created the app.'],
      previousUserMessages: ['Create an app.'],
    });

    expect(sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chars: currentSource.length,
          included: true,
          name: 'currentSource',
          priority: 3,
          protected: true,
          reason: 'protected',
        }),
      ]),
    );
    expect(sections.find((section) => section.name === 'currentSource')?.content).toContain(
      `<current_source>\n${currentSource}\n</current_source>`,
    );
    expect(formatContextMeterTooltip(sections)).toContain(`- currentSource: ${currentSource.length} chars protected`);
    expect(sections.find((section) => section.name === 'historySummary')?.content).toContain(
      '<history_summary>\nOlder context summary.\n</history_summary>',
    );
  });

  it('uses backend-provided prompt context limits for initial context rows', () => {
    const promptInfo: PromptsInfoResponse = {
      config: {
        cacheKeyPrefix: 'kitto:openui',
        maxOutputTokens: 30_000,
        model: 'gpt-test',
        modelPromptMaxChars: 50_000,
        outputMaxBytes: 100_000,
        repairTemperature: 0.2,
        requestMaxBytes: 300_000,
        temperature: 0.4,
        userPromptMaxChars: 4_096,
      },
      envelopeSchema: {},
      intentContext: {
        id: 'base',
        intentVector: 'base',
        label: 'Base',
        sampleRequest: null,
        text: '',
      },
      intentContextVariants: [],
      promptContextLimits: [
        {
          chars: 0,
          hardLimitChars: 4_096,
          included: false,
          name: 'latestUserPrompt',
          protected: true,
        },
        {
          chars: 0,
          hardLimitChars: 50_000,
          included: false,
          name: 'currentSource',
          protected: true,
        },
      ],
      repairPromptTemplate: '',
      requestPromptTemplate: '',
      staticPromptContextSections: [],
      systemPrompt: {
        cacheKey: 'kitto:openui:base:test',
        hash: '1234567890abcdef',
        id: 'base',
        intentVector: 'base',
        label: 'Base',
        sampleRequest: null,
        text: '',
      },
      systemPromptVariants: [],
      toolSpecs: [],
    };

    const sections = buildStaticPromptInfoContextSections(promptInfo);

    expect(sections.find((section) => section.name === 'latestUserPrompt')).toMatchObject({
      hardLimitChars: 4_096,
    });
    expect(sections.find((section) => section.name === 'currentSource')).toMatchObject({
      hardLimitChars: 50_000,
    });
  });
});
