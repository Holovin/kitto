import { describe, expect, it } from 'vitest';
import {
  compactPromptBuildChatHistory,
  filterPromptBuildChatHistory,
  retainPromptBuildChatHistory,
  retainPromptBuildChatHistoryTail,
  type RawPromptBuildChatHistoryMessage,
} from '#backend/prompts/openui.js';

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

  it('does not exclude assistant messages by template text alone', () => {
    expect(
      filterPromptBuildChatHistory(
        [
          createMessage('assistant', 'Applied the latest chat instruction to the app definition.'),
          createMessage('assistant', 'Building: Adds a welcome screen…'),
          createMessage('assistant', 'Updated the app definition from the latest chat instruction.'),
          createMessage('assistant', 'Updated the app.'),
          createMessage('assistant', 'Made the requested changes.'),
          createMessage('assistant', 'The first draft had parser issues, so it was repaired automatically before commit.'),
          createMessage('assistant', 'Kept the existing counter and added a reset button.'),
        ],
        10,
      ),
    ).toEqual([
      {
        content: 'Applied the latest chat instruction to the app definition.',
        role: 'assistant',
      },
      {
        content: 'Building: Adds a welcome screen…',
        role: 'assistant',
      },
      {
        content: 'Updated the app definition from the latest chat instruction.',
        role: 'assistant',
      },
      {
        content: 'Updated the app.',
        role: 'assistant',
      },
      {
        content: 'Made the requested changes.',
        role: 'assistant',
      },
      {
        content: 'The first draft had parser issues, so it was repaired automatically before commit.',
        role: 'assistant',
      },
      {
        content: 'Kept the existing counter and added a reset button.',
        role: 'assistant',
      },
    ]);
  });

  it('keeps user messages that match historical assistant-only templates', () => {
    expect(filterPromptBuildChatHistory([createMessage('user', 'Import failed, try a different layout instead.')], 10)).toEqual([
      {
        content: 'Import failed, try a different layout instead.',
        role: 'user',
      },
    ]);
  });

  it('uses turn-aware retention after excluding system and flagged assistant messages', () => {
    expect(
      filterPromptBuildChatHistory(
        [
          createMessage('user', 'First request'),
          createMessage('system', 'The model returned an invalid draft. Sending one automatic repair request now.'),
          createMessage('assistant', 'Updated the app definition from the latest chat instruction.', {
            excludeFromLlmContext: true,
          }),
          createMessage('assistant', 'Preserved the todo flow and added filters.'),
          createMessage('system', 'The chat context was compacted to the most recent window, so 1 older message was omitted from this request.'),
          createMessage('user', 'Add sorting'),
          createMessage('system', 'Reset the generated app state to its initial version.'),
        ],
        2,
      ),
    ).toEqual([
      {
        content: 'Add sorting',
        role: 'user',
      },
    ]);
  });
});

describe('retainPromptBuildChatHistory', () => {
  it('pins the first user request while keeping the newest remaining context', () => {
    expect(
      retainPromptBuildChatHistory(
        [
          { role: 'user', content: 'Build a todo app' },
          { role: 'assistant', content: 'Built the initial todo app.' },
          { role: 'user', content: 'Add filters' },
          { role: 'assistant', content: 'Added filters.' },
        ],
        3,
      ),
    ).toEqual([
      { role: 'user', content: 'Build a todo app' },
      { role: 'user', content: 'Add filters' },
      { role: 'assistant', content: 'Added filters.' },
    ]);
  });

  it('does not keep an assistant summary after dropping its paired user request', () => {
    expect(
      retainPromptBuildChatHistory(
        [
          { role: 'user', content: 'Create a signup form' },
          { role: 'assistant', content: 'Built the initial signup form.' },
          { role: 'user', content: 'Add a confirmation screen' },
          { role: 'assistant', content: 'Added a confirmation screen after submit.' },
          { role: 'user', content: 'Add an email filter' },
          { role: 'assistant', content: 'Added an email filter dropdown.' },
          { role: 'user', content: 'Remove filter and add validation' },
          { role: 'assistant', content: 'Removed the filter and added email validation.' },
        ],
        4,
      ),
    ).toEqual([
      { role: 'user', content: 'Create a signup form' },
      { role: 'user', content: 'Add an email filter' },
      { role: 'user', content: 'Remove filter and add validation' },
      { role: 'assistant', content: 'Removed the filter and added email validation.' },
    ]);
  });

  it('falls back to the newest tail when no user message exists', () => {
    expect(
      retainPromptBuildChatHistory(
        [
          { role: 'assistant', content: 'First summary' },
          { role: 'assistant', content: 'Second summary' },
          { role: 'assistant', content: 'Third summary' },
        ],
        2,
      ),
    ).toEqual([
      { role: 'assistant', content: 'Second summary' },
      { role: 'assistant', content: 'Third summary' },
    ]);
  });
});

describe('retainPromptBuildChatHistoryTail', () => {
  it('can shrink to the first user request plus the newest user turn without orphaning an assistant summary', () => {
    expect(
      retainPromptBuildChatHistoryTail(
        [
          { role: 'user', content: 'Build a todo app' },
          { role: 'assistant', content: 'Built the initial todo app.' },
          { role: 'user', content: 'Add filters' },
          { role: 'assistant', content: 'Added filters.' },
        ],
        1,
      ),
    ).toEqual([
      { role: 'user', content: 'Build a todo app' },
      { role: 'user', content: 'Add filters' },
    ]);
  });
});

describe('compactPromptBuildChatHistory', () => {
  it('adds a structured and bounded history summary when multiple older turns are omitted', () => {
    const messages = [
      createMessage('user', 'Create a todo app'),
      createMessage('assistant', 'Built a todo app with add and toggle controls.'),
      createMessage('user', 'Add filters'),
      createMessage('assistant', 'Added all, active, and completed filters.'),
      createMessage('user', 'Add theme'),
      createMessage('assistant', 'Added a light and dark theme toggle.'),
      createMessage('user', 'Add validation'),
      createMessage('assistant', 'Added required field validation.'),
      createMessage('user', 'Add sorting'),
      createMessage('assistant', 'Added sorting controls.'),
    ];
    const result = compactPromptBuildChatHistory(messages, {
      getSizeBytes: () => 0,
      maxBytes: 10_000,
      maxItems: 4,
    });

    const summaryMessage = result.chatHistory.find(
      (message) => message.role === 'assistant' && message.content.includes('<history_summary>'),
    );

    expect(result.chatHistory).toEqual([
      { role: 'user', content: 'Create a todo app' },
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('User: add'),
      }),
      { role: 'user', content: 'Add sorting' },
      { role: 'assistant', content: 'Added sorting controls.' },
    ]);
    expect(summaryMessage).toBeTruthy();
    expect(summaryMessage?.content).toContain('User: add filters');
    expect(summaryMessage?.content).toContain('Assistant: added all');
    expect(result.omittedChatMessages).toBe(6);
  });

  it('does not include a summary when too few older turns exist', () => {
    const messages = [
      createMessage('user', 'Create a todo app'),
      createMessage('assistant', 'Built a todo app with a due date field.'),
      createMessage('user', 'Add filters'),
      createMessage('assistant', 'Added basic filters.'),
    ];
    const result = compactPromptBuildChatHistory(messages, {
      getSizeBytes: () => 0,
      maxBytes: 10_000,
      maxItems: 3,
    });

    expect(result.chatHistory).toEqual([
      { role: 'user', content: 'Create a todo app' },
      { role: 'user', content: 'Add filters' },
      { role: 'assistant', content: 'Added basic filters.' },
    ]);
    expect(result.chatHistory).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.stringContaining('<history_summary>'),
        }),
      ]),
    );
    expect(result.omittedChatMessages).toBe(1);
  });

  it('keeps summary within byte budget while preserving the newest omitted turns', () => {
    const messages: RawPromptBuildChatHistoryMessage[] = [
      createMessage('user', 'Create a planner dashboard'),
      createMessage('assistant', 'Built the initial planner dashboard shell.'),
    ];

    for (let index = 2; index <= 10; index += 1) {
      messages.push(
        createMessage(
          'user',
          `Add feature ${index} for task management with advanced validation, sorting, filter toggles, keyboard shortcuts, and custom tags.`,
        ),
        createMessage(
          'assistant',
          `Added feature ${index} with deep layout adjustments, computed metadata, and resilient persisted state while preserving existing controls and labels.`,
        ),
      );
    }

    const result = compactPromptBuildChatHistory(messages, {
      getSizeBytes: () => 0,
      maxBytes: 10_000,
      maxItems: 3,
      maxSummaryCostBytes: 500,
    });

    const summaryMessage = result.chatHistory.find(
      (message) => message.role === 'assistant' && message.content.includes('<history_summary>'),
    );

    expect(summaryMessage).toBeTruthy();
    const summaryText = summaryMessage?.content ?? '';
    const firstUserMessage = result.chatHistory.find((message) => message.role === 'user' && message.content === 'Create a planner dashboard');
    const summaryIndex = summaryMessage ? result.chatHistory.indexOf(summaryMessage) : -1;
    const firstUserIndex = firstUserMessage ? result.chatHistory.indexOf(firstUserMessage) : -1;

    expect(Buffer.byteLength(summaryText)).toBeLessThanOrEqual(500);
    expect(summaryText).toContain('User: add feature 9');
    expect(summaryText).toContain('User: add feature 8');
    expect(summaryText).not.toContain('User: add feature 2');
    expect(firstUserIndex).toBeGreaterThan(-1);
    expect(summaryIndex).toBe(firstUserIndex + 1);
    expect(result.omittedChatMessages).toBe(17);
  });

  it('falls back to no summary when the requested budget is too small', () => {
    const messages: RawPromptBuildChatHistoryMessage[] = [
      createMessage('user', 'Create a checklist app'),
      createMessage('assistant', 'Built the base checklist app.'),
      createMessage('user', 'Add reminders'),
      createMessage('assistant', 'Added reminders section.'),
      createMessage('user', 'Add export'),
      createMessage('assistant', 'Added export controls.'),
      createMessage('user', 'Add sharing'),
      createMessage('assistant', 'Added sharing toggle.'),
      createMessage('user', 'Add search'),
      createMessage('assistant', 'Added search controls.'),
    ];

    const result = compactPromptBuildChatHistory(messages, {
      getSizeBytes: () => 0,
      maxBytes: 10_000,
      maxItems: 4,
      maxSummaryCostBytes: 1,
    });

    expect(result.chatHistory).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.stringContaining('<history_summary>'),
        }),
      ]),
    );
    expect(result.omittedChatMessages).toBe(6);
  });

  it('keeps the first user request pinned during byte compaction', () => {
    const messages = [
      { role: 'user', content: 'Build a catalog app ' + 'a'.repeat(48) },
      { role: 'assistant', content: 'Built the initial catalog app. ' + 'b'.repeat(96) },
      { role: 'user', content: 'Add filters ' + 'c'.repeat(48) },
      { role: 'assistant', content: 'Added filters and preserved the layout. ' + 'd'.repeat(96) },
    ] satisfies RawPromptBuildChatHistoryMessage[];
    const [firstUser, , latestUser] = messages;

    if (!firstUser || !latestUser) {
      throw new Error('Expected the test fixture chat history to include two user turns.');
    }

    const getSizeBytes = (chatHistory: Array<{ content: string; role: 'assistant' | 'user' }>) =>
      Buffer.byteLength(
        JSON.stringify({
          chatHistory,
          currentSource: '',
          mode: 'initial',
          prompt: 'trim this request',
        }),
      );
    const maxBytes = getSizeBytes([firstUser, latestUser]);

    expect(
      compactPromptBuildChatHistory(messages, {
        getSizeBytes,
        maxBytes,
      }),
    ).toEqual({
      chatHistory: [firstUser, latestUser],
      compactedByBytes: true,
      compactedByItemLimit: false,
      omittedChatMessages: 2,
    });
  });
});
