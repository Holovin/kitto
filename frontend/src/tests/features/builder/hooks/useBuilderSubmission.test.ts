import { describe, expect, it } from 'vitest';
import type { BuilderParseIssue } from '@features/builder/types';
import { buildRepairPrompt } from '@features/builder/hooks/repairPrompt';

describe('buildRepairPrompt', () => {
  it('includes Group argument-order rules in every repair prompt', () => {
    const prompt = buildRepairPrompt({
      userPrompt: 'Create a settings form with inline groups.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([])',
      issues: [],
      attemptNumber: 1,
      promptMaxChars: 4_000,
    });

    expect(prompt).toContain('Group signature is Group(title, direction, children, variant?).');
    expect(prompt).toContain('The second Group argument is direction and must be "vertical" or "horizontal".');
    expect(prompt).toContain('If you pass a Group variant, place it in the optional fourth argument.');
    expect(prompt).toContain('Never put "block" or "inline" in the second Group argument.');
  });

  it('adds targeted hints when Group.direction fails validation', () => {
    const issues: BuilderParseIssue[] = [
      {
        code: 'invalid-prop',
        message: 'Group.direction must be one of "vertical", "horizontal".',
        source: 'parser',
        statementId: 'root',
      },
    ];

    const prompt = buildRepairPrompt({
      userPrompt: 'Create a form with inline groups.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Group("Profile", "block", [], "inline")])',
      issues,
      attemptNumber: 1,
      promptMaxChars: 4_000,
    });

    expect(prompt).toContain('Targeted repair hints:');
    expect(prompt).toContain('Check component argument order against the documented signature before returning.');
    expect(prompt).toContain('For Group(...), the second argument is direction and must be "vertical" or "horizontal".');
    expect(prompt).toContain('If you need Group variant "block" or "inline", place it in the optional fourth argument.');
    expect(prompt).toContain('Never put "block" or "inline" in the second Group argument.');
    expect(prompt).toContain('invalid-prop in root: Group.direction must be one of "vertical", "horizontal".');
  });
});
