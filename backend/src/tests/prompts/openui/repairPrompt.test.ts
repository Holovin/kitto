import { describe, expect, it } from 'vitest';
import type { PromptBuildValidationIssue } from '../../../prompts/openui.js';
import { buildOpenUiRepairPrompt, buildOpenUiUserPrompt } from '../../../prompts/openui.js';

function extractSection(prompt: string, title: string, nextTitles: string[]) {
  const startMarker = `${title}:\n`;
  const startIndex = prompt.indexOf(startMarker);

  if (startIndex === -1) {
    return '';
  }

  const contentStart = startIndex + startMarker.length;
  const endIndex = nextTitles
    .map((nextTitle) => prompt.indexOf(`\n\n${nextTitle}:\n`, contentStart))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];

  return prompt.slice(contentStart, endIndex === undefined ? prompt.length : endIndex).trim();
}

function buildHugeDraft() {
  return `root = AppShell([
  Screen("main", "Main", [
    ${Array.from({ length: 160 }, (_, index) => `Text("line-${index + 1}", "Line ${index + 1}")`).join(',\n    ')},
    Text("END-OF-DRAFT", "tail")
  ])
])`;
}

describe('repair prompt assembly', () => {
  it('keeps initial-generation user prompts free of repair sections', () => {
    const prompt = buildOpenUiUserPrompt({
      prompt: 'Create a todo app.',
      currentSource: 'root = AppShell([])',
      mode: 'initial',
      chatHistory: [],
    });

    expect(prompt).toContain('<user_request>');
    expect(prompt).not.toContain('Validation issues:');
    expect(prompt).not.toContain('Quality issues:');
    expect(prompt).not.toContain('Targeted repair hints:');
    expect(prompt).not.toContain('Invalid model draft:');
  });

  it('caps repair issues to the backend limit while preserving parser and blocking-quality priority', () => {
    const issues: PromptBuildValidationIssue[] = [
      ...Array.from({ length: 22 }, (_, index) => ({
        code: 'unresolved-reference',
        message: `This statement was referenced but never defined in the final source (${index}).`,
        source: 'parser' as const,
        statementId: `row-${index}`,
      })),
      {
        code: 'invalid-prop',
        message: 'Group.direction must be one of "vertical", "horizontal".',
        source: 'parser',
        statementId: 'root',
      },
      {
        code: 'quality-options-shape',
        message: 'RadioGroup/Select options must be `{label, value}` objects, not bare strings or numbers.',
        source: 'quality',
        statementId: 'questions',
      },
      {
        code: 'quality-theme-state-not-applied',
        message: 'Theme state is declared but not applied to appearance.',
        source: 'quality',
        statementId: 'theme',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      attemptNumber: 1,
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Group("Profile", "block", [])])',
      issues,
      maxRepairAttempts: 1,
      promptMaxChars: 8_000,
      userPrompt: 'Repair the broken draft.',
    });
    const issueLines = extractSection(prompt, 'Validation and quality issues', ['Targeted repair hints'])
      .split('\n')
      .filter((line) => line.startsWith('- '));

    expect(issueLines).toHaveLength(20);
    expect(issueLines[0]).toContain('invalid-prop in root');
    expect(issueLines[1]).toContain('quality-options-shape in questions');
    expect(issueLines[19]).toContain('unresolved-reference in row-17');
    expect(prompt).not.toContain('quality-theme-state-not-applied in theme');
    expect(prompt).not.toContain('unresolved-reference in row-18');
  });

  it('dedupes repeated targeted hints by text', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'invalid-prop',
        message: 'Group.direction must be one of "vertical", "horizontal".',
        source: 'parser',
        statementId: 'root',
      },
      {
        code: 'invalid-prop',
        message: 'Group.direction must be one of "vertical", "horizontal".',
        source: 'parser',
        statementId: 'details',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      attemptNumber: 1,
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Group("Profile", "block", []), Group("Details", "block", [])])',
      issues,
      maxRepairAttempts: 1,
      promptMaxChars: 4_500,
      userPrompt: 'Fix the inline groups.',
    });
    const hintsSection = extractSection(prompt, 'Targeted repair hints', ['Invalid model draft']);

    expect(hintsSection.match(/Check component argument order against the documented signature before returning\./g)).toHaveLength(1);
    expect(
      hintsSection.match(/For Group\(\.\.\.\), the second argument is direction and must be "vertical" or "horizontal"\./g),
    ).toHaveLength(1);
    expect(hintsSection.match(/Never put "block" or "inline" in the second Group argument\./g)).toHaveLength(1);
  });

  it('keeps hints visible when the prompt budget forces the draft to truncate first', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'quality-options-shape',
        message: 'RadioGroup/Select options must be `{label, value}` objects, not bare strings or numbers.',
        source: 'quality',
        statementId: 'questions',
      },
      {
        code: 'undefined-state-reference',
        message: 'State reference `$filter` is missing a top-level declaration with a literal initial value. For example, add `$filter = ""`.',
        source: 'quality',
        statementId: 'root',
      },
      {
        code: 'undefined-state-reference',
        message: 'State reference `$draft` is missing a top-level declaration with a literal initial value. For example, add `$draft = ""`.',
        source: 'quality',
        statementId: 'root',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      attemptNumber: 1,
      committedSource: 'root = AppShell([])',
      invalidSource: buildHugeDraft(),
      issues,
      maxRepairAttempts: 1,
      promptMaxChars: 3_400,
      userPrompt: 'Repair the quiz draft.',
    });
    const hintsSection = extractSection(prompt, 'Targeted repair hints', ['Model draft to repair']);
    const draftSection = extractSection(prompt, 'Model draft to repair', ['Current critical syntax rules']);

    expect(hintsSection).toContain('Wrap each option in `{ label: "...", value: "..." }`.');
    expect(hintsSection).toContain('Add every missing `$var` as a top-level literal declaration before root.');
    expect(hintsSection).toContain('`$filter = ""`');
    expect(hintsSection).toContain('`$draft = ""`');
    expect(draftSection).toContain('…');
    expect(draftSection).not.toContain('END-OF-DRAFT');
  });
});
