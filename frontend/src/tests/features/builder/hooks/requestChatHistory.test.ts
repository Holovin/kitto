import { describe, expect, it } from 'vitest';
import type { BuilderChatMessage } from '@features/builder/types';
import { buildRequestChatHistory } from '@features/builder/hooks/requestChatHistory';

function createMessage(
  role: BuilderChatMessage['role'],
  content: string,
  tone: BuilderChatMessage['tone'] | 'warning' = 'default',
): BuilderChatMessage {
  return {
    id: `${role}-${content}`,
    role,
    content,
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

  it('includes assistant messages in request history', () => {
    expect(
      buildRequestChatHistory(
        [createMessage('assistant', 'Updated the app definition from the latest chat instruction.', 'success')],
        10,
      ),
    ).toEqual([
      {
        content: 'Updated the app definition from the latest chat instruction.',
        role: 'assistant',
      },
    ]);
  });

  it('respects the max item limit after excluding system messages', () => {
    expect(
      buildRequestChatHistory(
        [
          createMessage('user', 'First request'),
          createMessage('system', 'The model returned an invalid draft. Sending one automatic repair request now.', 'info'),
          createMessage('assistant', 'Updated the app definition from the latest chat instruction.', 'success'),
          createMessage('system', 'The chat context was compacted to the most recent window, so 1 older message was omitted from this request.', 'info'),
          createMessage('user', 'Add filters'),
          createMessage('system', 'Reset the generated app state to its initial version.', 'success'),
        ],
        2,
      ),
    ).toEqual([
      {
        content: 'Updated the app definition from the latest chat instruction.',
        role: 'assistant',
      },
      {
        content: 'Add filters',
        role: 'user',
      },
    ]);
  });
});
