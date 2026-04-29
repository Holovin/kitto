import { describe, expect, it } from 'vitest';
import { buildOpenUiUserPrompt } from '#backend/prompts/openui.js';

describe('buildOpenUiUserPrompt snapshots', () => {
  it('keeps the initial prompt snapshot stable', () => {
    expect(
      buildOpenUiUserPrompt(
        {
          prompt: 'Build a compact todo app',
          currentSource: 'root = AppShell([])',
          mode: 'initial',
          previousChangeSummaries: ['Added a compact filter row and preserved the existing layout.'],
          previousUserMessages: ['Add due dates.'],
        },
      ),
    ).toMatchSnapshot();
  });

  it('keeps the repair prompt snapshot stable', () => {
    expect(
      buildOpenUiUserPrompt(
        {
          prompt: 'Build a compact todo app',
          currentSource: 'root = AppShell([Screen("main", "Todo", [])])',
          invalidDraft: 'root = AppShell([Group("Todo", "block", [])])',
          mode: 'repair',
          parentRequestId: 'builder-request-parent',
          validationIssues: [
            {
              code: 'invalid-prop',
              message: 'Group.direction must be one of "vertical", "horizontal".',
              source: 'parser',
              statementId: 'root',
            },
            {
              code: 'quality-stale-persisted-query',
              context: {
                statementId: 'addItem',
                suggestedQueryRefs: ['items'],
              },
              message:
                'Persisted mutation may not refresh visible query. After @Run(addItem), also run @Run(items) later in the same Action for affected path "app.items".',
              source: 'quality',
              statementId: 'addItem',
            },
          ],
        },
        {
          maxRepairAttempts: 1,
          modelPromptMaxChars: 4_096,
        },
      ),
    ).toMatchSnapshot();
  });
});
