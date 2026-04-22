import { describe, expect, it } from 'vitest';
import { filterPromptBuildChatHistory, type RawPromptBuildChatHistoryMessage } from '../../prompts/openui.js';

function createMessage(
  role: RawPromptBuildChatHistoryMessage['role'],
  content: string,
  options?: {
    excludeFromLlmContext?: boolean;
  },
): RawPromptBuildChatHistoryMessage {
  return {
    content,
    excludeFromLlmContext: options?.excludeFromLlmContext,
    role,
  };
}

describe('filterPromptBuildChatHistory', () => {
  it('excludes system messages from prompt history', () => {
    expect(filterPromptBuildChatHistory([createMessage('system', 'Internal UI notice')], 10)).toEqual([]);
  });

  it('includes user messages in prompt history', () => {
    expect(filterPromptBuildChatHistory([createMessage('user', 'Build a todo app')], 10)).toEqual([
      {
        content: 'Build a todo app',
        role: 'user',
      },
    ]);
  });

  it('includes substantive assistant messages in prompt history', () => {
    expect(filterPromptBuildChatHistory([createMessage('assistant', 'Added a due date field and kept the existing layout.')], 10)).toEqual([
      {
        content: 'Added a due date field and kept the existing layout.',
        role: 'assistant',
      },
    ]);
  });

  it('excludes assistant messages marked to stay out of LLM context', () => {
    expect(
      filterPromptBuildChatHistory(
        [
          createMessage('assistant', 'Added filters and preserved the previous todo flow.'),
          createMessage('assistant', 'Updated the app definition from the latest chat instruction.', {
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
      filterPromptBuildChatHistory(
        [
          createMessage('assistant', 'Applied the latest chat instruction to the app definition.'),
          createMessage('assistant', 'Building: Adds a welcome screen…'),
          createMessage('assistant', 'Updated the app definition from the latest chat instruction.'),
          createMessage('assistant', 'The first draft had parser issues, so it was repaired automatically before commit.'),
          createMessage('assistant', 'Kept the existing counter and added a reset button.'),
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
    expect(filterPromptBuildChatHistory([createMessage('user', 'Import failed, try a different layout instead.')], 10)).toEqual([
      {
        content: 'Import failed, try a different layout instead.',
        role: 'user',
      },
    ]);
  });

  it('respects the max item limit after excluding system and low-signal assistant messages', () => {
    expect(
      filterPromptBuildChatHistory(
        [
          createMessage('user', 'First request'),
          createMessage('system', 'The model returned an invalid draft. Sending one automatic repair request now.'),
          createMessage('assistant', 'Updated the app definition from the latest chat instruction.'),
          createMessage('assistant', 'Preserved the todo flow and added filters.'),
          createMessage('system', 'The chat context was compacted to the most recent window, so 1 older message was omitted from this request.'),
          createMessage('user', 'Add sorting'),
          createMessage('system', 'Reset the generated app state to its initial version.'),
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
