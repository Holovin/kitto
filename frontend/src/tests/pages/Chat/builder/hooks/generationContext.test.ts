import { describe, expect, it } from 'vitest';
import {
  applyBackendPromptContextDisplayMetadata,
  buildPreviousChangeSummaries,
  buildPreviousUserMessages,
  buildStaticPromptInfoContextSections,
} from '@pages/Chat/builder/hooks/generationContext';
import type { PromptsInfoResponse } from '@pages/Chat/builder/types';

describe('generationContext', () => {
  it('derives previous user messages from visible user chat without rebuilding context sections', () => {
    expect(
      buildPreviousUserMessages([
        {
          id: 'user-1',
          content: ' Create an app. ',
          createdAt: '2026-01-01T00:00:00.000Z',
          role: 'user',
        },
        {
          id: 'user-2',
          content: 'Hidden retry context',
          createdAt: '2026-01-01T00:00:01.000Z',
          excludeFromLlmContext: true,
          role: 'user',
        },
        {
          id: 'assistant-1',
          content: 'Done.',
          createdAt: '2026-01-01T00:00:02.000Z',
          role: 'assistant',
        },
      ]),
    ).toEqual(['Create an app.']);
  });

  it('trims previous change summaries for request payloads', () => {
    expect(buildPreviousChangeSummaries([' Created a todo list. ', '', '  Added filters.'])).toEqual([
      'Created a todo list.',
      'Added filters.',
    ]);
  });

  it('uses backend-provided static context sections without rebuilding limits or placeholders', () => {
    const staticPromptContextSections: PromptsInfoResponse['staticPromptContextSections'] = [
      {
        chars: 0,
        content: '(populated by backend after Send)',
        hardLimitChars: 80_000,
        included: false,
        name: 'currentSource',
        priority: 6,
        protected: true,
        reason: 'waiting for request',
      },
    ];
    const promptInfo: PromptsInfoResponse = {
      config: {
        cacheKeyPrefix: 'kitto:openui',
        maxOutputTokens: 30_000,
        model: 'gpt-test',
        modelPromptMaxChars: 180_000,
        outputMaxBytes: 300_000,
        repairTemperature: 0.2,
        requestMaxBytes: 1_200_000,
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
      promptContextLimits: [],
      repairPromptTemplate: '',
      requestPromptTemplate: '',
      staticPromptContextSections,
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

    expect(buildStaticPromptInfoContextSections(promptInfo)).toBe(staticPromptContextSections);
  });

  it('hydrates missing display metadata from backend prompt info without deriving limit labels', () => {
    const sections = applyBackendPromptContextDisplayMetadata(
      [
        {
          chars: 42,
          content: '<current_source>...</current_source>',
          hardLimitChars: 80_000,
          included: true,
          name: 'currentSource',
          priority: 6,
          protected: true,
        },
      ],
      {
        config: {
          cacheKeyPrefix: 'kitto:openui',
          maxOutputTokens: 30_000,
          model: 'gpt-test',
          modelPromptMaxChars: 180_000,
          outputMaxBytes: 300_000,
          repairTemperature: 0.2,
          requestMaxBytes: 1_200_000,
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
        promptContextLimits: [],
        repairPromptTemplate: '',
        requestPromptTemplate: '',
        staticPromptContextSections: [
          {
            chars: 0,
            content: '(populated by backend after Send)',
            hardLimitChars: 80_000,
            included: false,
            limitLabels: ['HARD 80000'],
            name: 'currentSource',
            priority: 6,
            protected: true,
            reason: 'waiting for request',
          },
        ],
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
      },
    );

    expect(sections[0]?.limitLabels).toEqual(['HARD 80000']);
  });
});
