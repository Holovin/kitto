import { describe, expect, it } from 'vitest';
import { serializeBuilderLlmRequest } from '@pages/Chat/builder/api/requestBody';
import type { PromptBuildRequest } from '@pages/Chat/builder/types';

describe('serializeBuilderLlmRequest', () => {
  it('sends derived context and protected currentSource without legacy chatHistory or source replacement hints', () => {
    const request = {
      prompt: 'Add filtering.',
      currentSource: 'root = AppShell([Screen("main", "Main", [])])',
      currentSourceItems: 'Screen(main), Query(items)',
      chatHistory: [{ role: 'user', content: 'Raw visible transcript should stay client-side.' }],
      previousChangeSummaries: ['Created the initial app.'],
      previousUserMessages: ['Create the initial app.'],
      mode: 'initial',
    } as PromptBuildRequest & {
      currentSourceItems: string;
    };

    const payload = JSON.parse(serializeBuilderLlmRequest(request)) as Record<string, unknown>;

    expect(payload).toEqual({
      prompt: 'Add filtering.',
      currentSource: 'root = AppShell([Screen("main", "Main", [])])',
      previousChangeSummaries: ['Created the initial app.'],
      previousUserMessages: ['Create the initial app.'],
      mode: 'initial',
    });
    expect(payload).not.toHaveProperty('chatHistory');
    expect(payload).not.toHaveProperty('currentSourceItems');
  });
});
