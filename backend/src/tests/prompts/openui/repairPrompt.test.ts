import { describe, expect, it } from 'vitest';
import { CURRENT_SOURCE_EMERGENCY_MAX_CHARS } from '#backend/limits.js';
import type { PromptBuildValidationIssue } from '#backend/prompts/openui.js';
import { buildOpenUiRepairPrompt, buildOpenUiRepairRoleMessages, buildOpenUiUserPrompt } from '#backend/prompts/openui.js';

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

function extractDataBlock(prompt: string, tagName: string) {
  const match = prompt.match(new RegExp(`<${tagName}>\\n([\\s\\S]*?)\\n</${tagName}>`));

  return match?.[1] ?? '';
}

function buildHugeDraft() {
  return `root = AppShell([
  Screen("main", "Main", [
    ${Array.from({ length: 160 }, (_, index) => `Text("line-${index + 1}", "Line ${index + 1}")`).join(',\n    ')},
    Text("END-OF-DRAFT", "tail")
  ])
])`;
}

function buildLateStatementDraft() {
  const fillerStatements = Array.from(
    { length: 220 },
    (_, index) => `filler${index + 1} = Text("line-${index + 1}", "body", "start")`,
  ).join('\n');

  return `${fillerStatements}
problemGroup = Group("Problem", "block", [
  Text("Bad group", "body", "start")
])
root = AppShell([problemGroup])`;
}

function buildRepairPrioritySource(label: string) {
  const rows = Array.from({ length: 24 }, (_, index) => `Text("${label}-${index + 1}", "body", "start")`).join(',\n    ');

  return `root = AppShell([
  Screen("main", "Main", [
    ${rows},
    Text("${label}-TAIL", "body", "start")
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

    expect(prompt).toContain('<latest_user_request>');
    expect(prompt).not.toContain('Validation issues:');
    expect(prompt).not.toContain('Quality issues:');
    expect(prompt).not.toContain('Targeted repair hints:');
    expect(prompt).not.toContain('Invalid model draft:');
  });

  it('accepts previousSource on repair requests without adding previous-change data sections', () => {
    const prompt = buildOpenUiUserPrompt({
      prompt: 'Fix the broken draft.',
      previousSource: 'root = AppShell([Screen("main", "Main", [])])',
      currentSource: 'root = AppShell([Screen("main", "Main", [])])',
      invalidDraft: 'root = AppShell([',
      mode: 'repair',
      chatHistory: [],
      parentRequestId: 'req-1',
      repairAttemptNumber: 1,
      validationIssues: [
        {
          code: 'parser',
          source: 'parser',
          message: 'Parser found issues in the draft.',
        },
      ],
    });

    expect(prompt).toContain('Original user request');
    expect(prompt).toContain('Validation issues');
    expect(prompt).toContain('Invalid model draft');
    expect(prompt).not.toContain('<previous_changes>');
  });

  it('keeps fallback text in role-based repair source sections when section budgets are exhausted', () => {
    const messages = buildOpenUiRepairRoleMessages({
      attemptNumber: 1,
      committedSource: '',
      invalidSource: '',
      issues: [],
      maxRepairAttempts: 1,
      promptMaxChars: 1,
      userPrompt: '',
    });

    expect(extractDataBlock(messages.requestContext, 'original_user_request')).toBe('(empty user request)');
    expect(extractDataBlock(messages.requestContext, 'current_source')).toBe(
      '(blank canvas, no committed OpenUI source yet)',
    );
    expect(extractDataBlock(messages.failedDraft, 'model_draft_that_failed')).toBe('(the failed draft was empty)');
    expect(extractDataBlock(messages.correctionRequest, 'validation_issues')).toBe(
      '- Validation issues were detected, but they could not be enumerated in full.',
    );
  });

  it('keeps committed source up to the emergency cap in role-based repair context', () => {
    const tail = 'COMMITTED-SOURCE-TAIL';
    const committedSource = `${'c'.repeat(CURRENT_SOURCE_EMERGENCY_MAX_CHARS - tail.length)}${tail}`;
    const messages = buildOpenUiRepairRoleMessages({
      attemptNumber: 1,
      committedSource,
      invalidSource: 'root = AppShell([missing])',
      issues: [
        {
          code: 'unresolved-reference',
          message: 'Missing statement.',
          source: 'parser',
          statementId: 'root',
        },
      ],
      maxRepairAttempts: 1,
      promptMaxChars: 180_000,
      userPrompt: 'Repair the app.',
    });

    expect(extractDataBlock(messages.requestContext, 'current_source')).toBe(committedSource);
    expect(messages.requestContext).not.toContain('Committed source is large; use this compact context instead of the full source.');
    expect(messages.requestContext).not.toContain('Inventory:');
  });

  it('fails repair prompt building when committed source exceeds the emergency cap', () => {
    expect(() =>
      buildOpenUiRepairRoleMessages({
        attemptNumber: 1,
        committedSource: 'x'.repeat(CURRENT_SOURCE_EMERGENCY_MAX_CHARS + 1),
        invalidSource: 'root = AppShell([missing])',
        issues: [],
        maxRepairAttempts: 1,
        promptMaxChars: 180_000,
        userPrompt: 'Repair the app.',
      }),
    ).toThrow(`Committed source exceeded the repair source cap of ${CURRENT_SOURCE_EMERGENCY_MAX_CHARS} characters.`);
  });

  it('includes derived repair context in the repair prompt with newest context first', () => {
    const prompt = buildOpenUiUserPrompt({
      prompt: 'Create a todo app.',
      currentSource: 'root = AppShell([])',
      invalidDraft: 'root = AppShell([missing])',
      mode: 'repair',
      historySummary: 'Older transcript summary.',
      previousUserMessages: ['Earlier user request.', 'Latest previous user request.'],
      previousChangeSummaries: ['Created the todo app.', 'Added filters.'],
      validationIssues: [
        {
          code: 'undefined-state-reference',
          context: {
            refName: '$filter',
          },
          message: 'State reference `$filter` is missing a top-level declaration with a literal initial value.',
          source: 'quality',
          statementId: 'root',
        },
      ],
    });
    const contextSection = extractSection(prompt, 'Recent conversation context (newest first)', [
      'Current committed valid OpenUI source',
    ]);

    expect(contextSection.split('\n')[0]).toBe('- History summary: Older transcript summary.');
    expect(contextSection).toContain('- Previous user prompt: Latest previous user request.');
    expect(contextSection).toContain('- Previous user prompt: Earlier user request.');
    expect(contextSection).toContain('- Previous committed change: Added filters.');
    expect(contextSection).toContain('- Previous committed change: Created the todo app.');
  });

  it('bounds role-based repair derived context', () => {
    const messages = buildOpenUiRepairRoleMessages({
      attemptNumber: 1,
      previousUserMessages: [`Earlier context ${'x '.repeat(2_000)}tail-marker`],
      previousChangeSummaries: ['Previous committed summary.'],
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([missing])',
      issues: [
        {
          code: 'unresolved-reference',
          message: 'This statement was referenced but never defined in the final source.',
          source: 'parser',
          statementId: 'missing',
        },
      ],
      maxRepairAttempts: 2,
      promptMaxChars: 3_000,
      userPrompt: 'Fix the invalid draft.',
    });
    const contextBlock = extractDataBlock(messages.requestContext, 'conversation_context');

    expect(contextBlock).toContain('- Previous user prompt: Earlier context');
    expect(contextBlock).toContain('…');
    expect(contextBlock).not.toContain('tail-marker');
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
        context: {
          groupId: 'questions',
          invalidValues: ['Never gonna give you up'],
        },
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
    expect(issueLines[2]).toContain('quality-theme-state-not-applied in theme');
    expect(issueLines[19]).toContain('unresolved-reference in row-16');
    expect(prompt).not.toContain('unresolved-reference in row-17');
  });

  it('prioritizes explicit blocking severity for dynamic quality codes', () => {
    const issues: PromptBuildValidationIssue[] = [
      ...Array.from({ length: 22 }, (_, index) => ({
        code: 'unresolved-reference',
        message: `This statement was referenced but never defined in the final source (${index}).`,
        source: 'parser' as const,
        statementId: `row-${index}`,
      })),
      {
        code: 'quality-missing-todo-controls',
        message: 'Todo request did not generate required todo controls.',
        severity: 'blocking-quality',
        source: 'quality',
        statementId: 'root',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      attemptNumber: 1,
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([])',
      issues,
      maxRepairAttempts: 1,
      promptMaxChars: 8_000,
      userPrompt: 'Create a todo list.',
    });
    const issueLines = extractSection(prompt, 'Validation and quality issues', ['Targeted repair hints'])
      .split('\n')
      .filter((line) => line.startsWith('- '));

    expect(issueLines).toHaveLength(20);
    expect(issueLines[0]).toContain('quality-missing-todo-controls in root');
    expect(issueLines[19]).toContain('unresolved-reference in row-18');
    expect(prompt).not.toContain('unresolved-reference in row-19');
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
    const hintsSection = extractSection(prompt, 'Targeted repair hints', ['Relevant draft statement excerpts', 'Invalid model draft']);

    expect(hintsSection.match(/Check component argument order against the documented signature before returning\./g)).toHaveLength(1);
    expect(
      hintsSection.match(/For Group\(\.\.\.\), the second argument is direction and must be "vertical" or "horizontal"\./g),
    ).toHaveLength(1);
    expect(hintsSection.match(/Never put "block" or "inline" in the second Group argument\./g)).toHaveLength(1);
  });

  it('filters repair critical rules to component argument rules for invalid props', () => {
    const prompt = buildOpenUiRepairPrompt({
      attemptNumber: 1,
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Group("Filters", "block", [])])',
      issues: [
        {
          code: 'invalid-prop',
          message: 'Group.direction must be one of "vertical", "horizontal".',
          source: 'parser',
          statementId: 'root',
        },
      ],
      maxRepairAttempts: 1,
      promptMaxChars: 8_000,
      userPrompt: 'Fix the group.',
    });
    const rulesSection = extractSection(prompt, 'Current critical syntax rules', []);

    expect(rulesSection).toContain('The second Group argument is direction and must be "vertical" or "horizontal".');
    expect(rulesSection).toContain('If you pass a Group variant, place it in the optional fourth argument.');
    expect(rulesSection).not.toContain('$lastChoice');
  });

  it('keeps last-choice repair rules only for last-choice issues', () => {
    const prompt = buildOpenUiRepairPrompt({
      attemptNumber: 1,
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Screen("main", "Main", [Text($lastChoice, "body", "start")])])',
      issues: [
        {
          code: 'reserved-last-choice-outside-action-mode',
          message: '$lastChoice can only be used in Select/RadioGroup action-mode flows.',
          source: 'quality',
          statementId: 'root',
        },
      ],
      maxRepairAttempts: 1,
      promptMaxChars: 8_000,
      userPrompt: 'Repair the choice UI.',
    });
    const rulesSection = extractSection(prompt, 'Current critical syntax rules', []);

    expect(rulesSection).toContain('When RadioGroup or Select runs in action mode');
    expect(rulesSection).toContain('Do not read `$lastChoice` directly in Text(...)');
  });

  it('keeps hints visible when the prompt budget forces the draft to truncate first', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'quality-options-shape',
        context: {
          groupId: 'questions',
          invalidValues: ['Never gonna give you up'],
        },
        message: 'RadioGroup/Select options must be `{label, value}` objects, not bare strings or numbers.',
        source: 'quality',
        statementId: 'questions',
      },
      {
        code: 'undefined-state-reference',
        context: {
          exampleInitializer: '""',
          refName: '$filter',
        },
        message: 'State reference `$filter` is missing a top-level declaration with a literal initial value. For example, add `$filter = ""`.',
        source: 'quality',
        statementId: 'root',
      },
      {
        code: 'undefined-state-reference',
        context: {
          exampleInitializer: '""',
          refName: '$draft',
        },
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
    const hintsSection = extractSection(prompt, 'Targeted repair hints', ['Relevant draft statement excerpts', 'Model draft to repair']);
    const draftSection = extractSection(prompt, 'Model draft to repair', ['Current critical syntax rules']);

    expect(hintsSection).toContain('Wrap each option in `{ label: "...", value: "..." }`.');
    expect(hintsSection).toContain('- Example');
    expect(hintsSection).toContain('Add every missing `$var` before root.');
    expect(hintsSection).toContain('`$filter = ""`');
    expect(hintsSection).toContain('`$draft = ""`');
    expect(draftSection).toContain('…');
    expect(draftSection).not.toContain('END-OF-DRAFT');
  });

  it('adds matching statement excerpts before a truncated draft', () => {
    const prompt = buildOpenUiRepairPrompt({
      attemptNumber: 1,
      committedSource: 'root = AppShell([])',
      invalidSource: buildLateStatementDraft(),
      issues: [
        {
          code: 'quality-custom',
          message: 'The statement uses an invalid Group direction.',
          source: 'quality',
          statementId: 'problemGroup',
        },
      ],
      maxRepairAttempts: 1,
      promptMaxChars: 4_200,
      userPrompt: 'Repair the late statement.',
    });
    const excerptSection = extractSection(prompt, 'Relevant draft statement excerpts', ['Model draft to repair']);
    const draftSection = extractSection(prompt, 'Model draft to repair', ['Current critical syntax rules']);

    expect(excerptSection).toContain('- problemGroup:');
    expect(excerptSection).toContain('problemGroup = Group("Problem", "block", [');
    expect(draftSection).toContain('…');
    expect(draftSection).not.toContain('problemGroup = Group("Problem", "block", [');
  });

  it('dedupes statement excerpts and skips statement IDs absent from the draft', () => {
    const prompt = buildOpenUiRepairPrompt({
      attemptNumber: 1,
      committedSource: 'root = AppShell([])',
      invalidSource: `problemGroup = Group("Problem", "block", [])
root = AppShell([problemGroup])`,
      issues: [
        {
          code: 'quality-custom',
          message: 'The statement uses an invalid Group direction.',
          source: 'quality',
          statementId: 'problemGroup',
        },
        {
          code: 'quality-custom',
          message: 'The same statement was reported again.',
          source: 'quality',
          statementId: 'problemGroup',
        },
        {
          code: 'quality-custom',
          message: 'This statement is missing from the draft.',
          source: 'quality',
          statementId: 'missingStatement',
        },
      ],
      maxRepairAttempts: 1,
      promptMaxChars: 4_200,
      userPrompt: 'Repair the draft.',
    });
    const excerptSection = extractSection(prompt, 'Relevant draft statement excerpts', ['Model draft to repair']);

    expect(excerptSection.match(/- problemGroup:/g)).toHaveLength(1);
    expect(excerptSection).not.toContain('missingStatement');
  });

  it('prioritizes the model draft over committed fallback source for tight quality repairs', () => {
    const baseArgs = {
      attemptNumber: 1,
      committedSource: buildRepairPrioritySource('COMMITTED'),
      invalidSource: buildRepairPrioritySource('DRAFT'),
      issues: [
        {
          code: 'quality-custom',
          message: 'The syntactically valid draft needs a small product-quality repair.',
          source: 'quality' as const,
        },
      ],
      maxRepairAttempts: 1,
      userPrompt: 'Repair the generated app without rewriting unrelated parts.',
    };
    const fullPrompt = buildOpenUiRepairPrompt({
      ...baseArgs,
      promptMaxChars: 20_000,
    });
    const prompt = buildOpenUiRepairPrompt({
      ...baseArgs,
      promptMaxChars: fullPrompt.length - 120,
    });
    const draftSection = extractSection(prompt, 'Model draft to repair', ['Current critical syntax rules']);

    expect(draftSection).toContain('DRAFT-TAIL');
    expect(prompt).not.toContain('Current committed valid OpenUI source');
    expect(prompt).not.toContain('COMMITTED-TAIL');
  });

  it('keeps parser repairs biased toward the committed source baseline when tightly budgeted', () => {
    const baseArgs = {
      attemptNumber: 1,
      committedSource: buildRepairPrioritySource('COMMITTED'),
      invalidSource: buildRepairPrioritySource('DRAFT'),
      issues: [
        {
          code: 'parser-custom',
          message: 'The invalid draft cannot be parsed safely.',
          source: 'parser' as const,
        },
      ],
      maxRepairAttempts: 1,
      userPrompt: 'Repair the generated app without rewriting unrelated parts.',
    };
    const fullPrompt = buildOpenUiRepairPrompt({
      ...baseArgs,
      promptMaxChars: 20_000,
    });
    const prompt = buildOpenUiRepairPrompt({
      ...baseArgs,
      promptMaxChars: fullPrompt.length - 120,
    });
    const committedSection = extractSection(prompt, 'Current committed valid OpenUI source', ['Validation issues']);
    const draftSection = extractSection(prompt, 'Invalid model draft', ['Current critical syntax rules']);

    expect(committedSection).toContain('COMMITTED-TAIL');
    expect(draftSection).toContain('…');
    expect(draftSection).not.toContain('DRAFT-TAIL');
  });
});
