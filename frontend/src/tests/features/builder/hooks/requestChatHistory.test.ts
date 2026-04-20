import { describe, expect, it } from 'vitest';
import type { BuilderChatMessage } from '@features/builder/types';
import { buildRequestChatHistory } from '@features/builder/hooks/requestChatHistory';

function createMessage(
  role: BuilderChatMessage['role'],
  content: string,
  tone: BuilderChatMessage['tone'] | 'warning' = 'default',
  options?: {
    excludeFromLlmContext?: boolean;
  },
): BuilderChatMessage {
  return {
    id: `${role}-${content}`,
    role,
    content,
    excludeFromLlmContext: options?.excludeFromLlmContext,
    tone: tone as BuilderChatMessage['tone'],
    createdAt: '2026-04-19T10:00:00.000Z',
  };
}

describe('buildRequestChatHistory', () => {
  it.each(['info', 'success', 'error', 'warning'] as const)('excludes system %s messages from request history', (tone) => {
    expect(buildRequestChatHistory([createMessage('system', `system ${tone} message`, tone)], 10)).toEqual([]);
  });

  it('excludes system messages even when they use the default tone', () => {
    expect(buildRequestChatHistory([createMessage('system', 'Internal UI notice')], 10)).toEqual([]);
  });

  it('includes user messages in request history', () => {
    expect(buildRequestChatHistory([createMessage('user', 'Build a todo app')], 10)).toEqual([
      {
        content: 'Build a todo app',
        role: 'user',
      },
    ]);
  });

  it('includes substantive assistant messages in request history', () => {
    expect(
      buildRequestChatHistory([createMessage('assistant', 'Added a due date field and kept the existing layout.', 'success')], 10),
    ).toEqual([
      {
        content: 'Added a due date field and kept the existing layout.',
        role: 'assistant',
      },
    ]);
  });

  it('excludes assistant messages marked to stay out of LLM context', () => {
    expect(
      buildRequestChatHistory(
        [
          createMessage('assistant', 'Added filters and preserved the previous todo flow.', 'success'),
          createMessage('assistant', 'Updated the app definition from the latest chat instruction.', 'success', {
            excludeFromLlmContext: true,
          }),
        ],
        10,
      ),
    ).toEqual([
      {
        content: 'Added filters and preserved the previous todo flow.',
        role: 'assistant',
      },
    ]);
  });

  it('falls back to filtering legacy persisted assistant summaries by template text', () => {
    expect(
      buildRequestChatHistory(
        [
          createMessage('assistant', 'Updated the app definition from the latest chat instruction.', 'success'),
          createMessage('assistant', 'The first draft had parser issues, so it was repaired automatically before commit.', 'success'),
          createMessage('assistant', 'Kept the existing counter and added a reset button.', 'success'),
        ],
        10,
      ),
    ).toEqual([
      {
        content: 'Kept the existing counter and added a reset button.',
        role: 'assistant',
      },
    ]);
  });

  it('does not apply legacy assistant-summary fallback rules to user messages', () => {
    expect(buildRequestChatHistory([createMessage('user', 'Import failed, try a different layout instead.')], 10)).toEqual([
      {
        content: 'Import failed, try a different layout instead.',
        role: 'user',
      },
    ]);
  });

  it('respects the max item limit after excluding system and low-signal assistant messages', () => {
    expect(
      buildRequestChatHistory(
        [
          createMessage('user', 'First request'),
          createMessage('system', 'The model returned an invalid draft. Sending one automatic repair request now.', 'info'),
          createMessage('assistant', 'Updated the app definition from the latest chat instruction.', 'success'),
          createMessage('assistant', 'Preserved the todo flow and added filters.', 'success'),
          createMessage('system', 'The chat context was compacted to the most recent window, so 1 older message was omitted from this request.', 'info'),
          createMessage('user', 'Add sorting'),
          createMessage('system', 'Reset the generated app state to its initial version.', 'success'),
        ],
        2,
      ),
    ).toEqual([
      {
        content: 'Preserved the todo flow and added filters.',
        role: 'assistant',
      },
      {
        content: 'Add sorting',
        role: 'user',
      },
    ]);
  });
});
