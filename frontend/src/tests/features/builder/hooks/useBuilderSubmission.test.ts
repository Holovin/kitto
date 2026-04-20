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

    expect(prompt).toContain('AppShell signature is AppShell(children, appearance?).');
    expect(prompt).toContain('Group signature is Group(title, direction, children, variant?, appearance?).');
    expect(prompt).toContain('The second Group argument is direction and must be "vertical" or "horizontal".');
    expect(prompt).toContain('If you pass a Group variant, place it in the optional fourth argument.');
    expect(prompt).toContain('Never put "block" or "inline" in the second Group argument.');
    expect(prompt).toContain('Use appearance only as { mainColor?: "#RRGGBB", contrastColor?: "#RRGGBB" }.');
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

  it('adds targeted hints when color props fail validation', () => {
    const issues: BuilderParseIssue[] = [
      {
        code: 'invalid-prop',
        message: 'Text.appearance.contrastColor must be a #RRGGBB hex color.',
        source: 'parser',
        statementId: 'root',
      },
    ];

    const prompt = buildRepairPrompt({
      userPrompt: 'Add dark mode.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Text("Hello", "body", "start", { contrastColor: "red" })])',
      issues,
      attemptNumber: 1,
      promptMaxChars: 4_000,
    });

    expect(prompt).toContain('Use appearance.mainColor and appearance.contrastColor only as six-character #RRGGBB hex strings such as "#111827" or "#F9FAFB".');
    expect(prompt).toContain('Use appearance only with mainColor and contrastColor keys. Do not use textColor, bgColor, or color/background prop names.');
    expect(prompt).toContain('For Button default, contrastColor becomes the button background and mainColor becomes the button text.');
    expect(prompt).toContain('Do not use named colors, rgb(), hsl(), var(), url(), CSS objects, or className/style props.');
    expect(prompt).toContain('invalid-prop in root: Text.appearance.contrastColor must be a #RRGGBB hex color.');
  });
});
