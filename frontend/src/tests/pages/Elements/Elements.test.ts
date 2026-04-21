import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@openuidev/react-lang', async () => {
  const actual = await vi.importActual<typeof import('@openuidev/react-lang')>('@openuidev/react-lang');

  return {
    ...actual,
    Renderer: () => createElement('div', { 'data-testid': 'mock-renderer' }),
  };
});

const promptsInfoState = vi.hoisted(() => ({
  data: {
    config: {
      cacheKeyPrefix: 'kitto:openui',
      maxOutputTokens: 25_000,
      model: 'gpt-5.4-mini',
      outputMaxBytes: 100_000,
      requestMaxBytes: 300_000,
      structuredOutput: true,
      temperature: 0.6,
    },
    envelopeSchema: {
      type: 'object',
      required: ['summary', 'source'],
    },
    repairPromptTemplate: 'Original user request:\n{{userPrompt}}',
    systemPrompt: {
      hash: 'abcd1234efgh5678',
      text: 'System prompt body',
    },
    toolSpecs: [
      {
        description: 'Read a value from persisted state.',
        name: 'read_state',
        signature: 'read_state(path)',
      },
    ],
    userPromptTemplate: '<user_request>\n[latest user request text]\n</user_request>',
  },
}));

vi.mock('@api/apiSlice', () => ({
  useGetPromptsInfoQuery: () => ({
    data: promptsInfoState.data,
    error: undefined,
    isError: false,
    isLoading: false,
  }),
}));

import ElementsPage from '@pages/Elements/Elements';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function setWindowHash(hash: string) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { hash },
    },
  });
}

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, 'window');
});

describe('ElementsPage', () => {
  it('renders the action catalog when the hash targets an action reference', () => {
    setWindowHash('#read-state');

    const markup = renderToStaticMarkup(createElement(ElementsPage));

    expect(markup).toContain('Actions');
    expect(markup).toContain('read_state(path)');
    expect(markup).toContain('Read stored value');
    expect(markup).toContain('Reads the current persisted value stored at the requested non-empty state path.');
    expect(markup).toContain('compute_value(op, input?, left?, right?, values?, options?, returnType?)');
  });

  it('renders the prompts catalog when the hash targets a prompt reference', () => {
    setWindowHash('#system-prompt');

    const markup = renderToStaticMarkup(createElement(ElementsPage));

    expect(markup).toContain('Prompts');
    expect(markup).toContain('Backend config');
    expect(markup).toContain('System prompt');
    expect(markup).toContain('systemPromptHash: abcd1234efgh5678');
    expect(markup).toContain('Tool specs');
    expect(markup).toContain('Output envelope schema');
    expect(markup).not.toContain('Notes');
  });
});
