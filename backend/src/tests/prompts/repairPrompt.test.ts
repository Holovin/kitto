import { describe, expect, it } from 'vitest';
import type { PromptBuildValidationIssue } from '#backend/prompts/openui.js';
import { buildOpenUiRepairPrompt } from '#backend/prompts/openui.js';
import { getOpenUiComponentCompactSignature } from '#backend/prompts/openui/componentSpec.js';

function buildUndefinedStateReferenceIssues(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const refName = `$q${index + 1}`;

    return {
      code: 'undefined-state-reference',
      context: {
        exampleInitializer: '""',
        refName,
      },
      message: `State reference \`${refName}\` is missing a top-level declaration with a literal initial value. For example, add \`${refName} = ""\`.`,
      source: 'quality',
      statementId: 'root',
    } satisfies PromptBuildValidationIssue;
  });
}

function buildHugeQuizDraft(count: number) {
  const questionGroups = Array.from({ length: count }, (_, index) => {
    const questionNumber = index + 1;

    return `Group("Question ${questionNumber}", "vertical", [
  Text("Question ${questionNumber}", "body", "start"),
  RadioGroup("question-${questionNumber}", "Question ${questionNumber}", $q${questionNumber}, [
    { label: "Yes", value: "yes" },
    { label: "No", value: "no" }
  ])
])`;
  }).join(',\n');
  const fillerText = Array.from({ length: 220 }, (_, index) => `Text("Filler line ${index + 1}", "body", "start")`).join(',\n');

  return `root = AppShell([
  Screen("quiz", "Quiz", [
${questionGroups},
${fillerText},
    Text("END-OF-DRAFT", "body", "start")
  ])
])`;
}

describe('buildOpenUiRepairPrompt', () => {
  it('includes Group argument-order rules in every repair prompt', () => {
    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Create a settings form with inline groups.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([])',
      issues: [],
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_000,
    });

    expect(prompt).toContain('Place the full corrected OpenUI Lang program in `source`.');
    expect(prompt).not.toContain('Return only raw OpenUI Lang.');
    expect(prompt).toContain(
      'Make `summary` one complete user-facing sentence under 200 characters with concrete features/screens, not generic "Updated the app" text.',
    );
    expect(prompt).toContain(`AppShell signature is \`${getOpenUiComponentCompactSignature('AppShell')}\`.`);
    expect(prompt).toContain(
      'AppShell must be the single root statement; never nest AppShell and never define a second AppShell anywhere else in the source.',
    );
    expect(prompt).toContain(`Group signature is \`${getOpenUiComponentCompactSignature('Group')}\`.`);
    expect(prompt).toContain('The second Group argument is direction and must be "vertical" or "horizontal".');
    expect(prompt).toContain('If you pass a Group variant, place it in the optional fourth argument.');
    expect(prompt).toContain('Never put "block" or "inline" in the second Group argument.');
    expect(prompt).toContain(
      'Screen never contains another Screen at any depth. Keep Screens as top-level AppShell children and use Group for local layout inside a screen.',
    );
    expect(prompt).toContain(
      'Repeater never contains another Repeater at any depth. Flatten nested list ideas or use Group inside the row template instead of nesting Repeaters.',
    );
    expect(prompt).toContain(
      'Mutation(...) and Query(...) must be top-level statements. Never inline them inside @Each(...), Repeater(...), component props, or other expressions.',
    );
    expect(prompt).toContain(
      'Declare every `$var` that appears anywhere in the program at the top with a literal initial value, even if the draft excerpt below is truncated.',
    );
    expect(prompt).toContain('Use appearance only as { mainColor?: "#RRGGBB", contrastColor?: "#RRGGBB" }.');
    expect(prompt).toContain('Invalid model draft:');
    expect(prompt).toContain('Validation issues:');
  });

  it('adds targeted hints when Group.direction fails validation', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'invalid-prop',
        message: 'Group.direction must be one of "vertical", "horizontal".',
        source: 'parser',
        statementId: 'root',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Create a form with inline groups.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Group("Profile", "block", [], "inline")])',
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
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
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'invalid-prop',
        message: 'Text.appearance.contrastColor must be a #RRGGBB hex color.',
        source: 'parser',
        statementId: 'root',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Add dark mode.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Text("Hello", "body", "start", { contrastColor: "red" })])',
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_000,
    });

    expect(prompt).toContain('Use appearance.mainColor and appearance.contrastColor only as six-character #RRGGBB hex strings such as "#111827" or "#F9FAFB".');
    expect(prompt).toContain('Use appearance only with mainColor and contrastColor keys. Do not use textColor, bgColor, or color/background prop names.');
    expect(prompt).toContain('For any `Button` variant with appearance, background uses mainColor and text uses contrastColor.');
    expect(prompt).toContain('Do not use named colors, rgb(), hsl(), var(), url(), CSS objects, or className/style props.');
    expect(prompt).toContain('invalid-prop in root: Text.appearance.contrastColor must be a #RRGGBB hex color.');
  });

  it('adds targeted hints for stale persisted query refresh warnings', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'quality-stale-persisted-query',
        context: {
          statementId: 'addItem',
          suggestedQueryRefs: ['items'],
        },
        message: 'Persisted mutation may not refresh visible query.',
        source: 'quality',
        statementId: 'addItem',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Create a todo list.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([])',
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_000,
    });

    expect(prompt).toContain('Targeted repair hints:');
    expect(prompt).toContain('The draft is syntactically valid but fails a product-quality check.');
    expect(prompt).toContain('Use the current committed valid OpenUI source only as fallback context.');
    expect(prompt).toContain('Stay close to the model draft below and fix only the listed quality issues with the smallest possible diff.');
    expect(prompt).toContain('Do not rewrite unrelated parts, change unflagged behavior, or introduce new features.');
    expect(prompt).toContain('Model draft to repair:');
    expect(prompt).toContain('Quality issues:');
    expect(prompt).toContain(
      'The mutation updates persisted state used by visible UI, but the action does not re-run the query that reads it. Add @Run(items) later in the same Action after @Run(addItem).',
    );
    expect(prompt).toContain(
      'A matching persisted query can read the same path, a parent path, or a child path of the mutation path. Other steps such as @Reset(...) or @Set(...) may stay in the Action.',
    );
    expect(prompt).toContain(
      'quality-stale-persisted-query in addItem: Persisted mutation may not refresh visible query.',
    );
  });

  it('injects the control-action-and-binding repair hint into the issues section', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'control-action-and-binding',
        message:
          'Form-control cannot have both action and a writable $binding. Use $binding for form state, or action for persisted updates.',
        source: 'quality',
        statementId: 'root',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Create a persisted filter control.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Select("filter", "Filter", $filter, filterOptions, null, [], Action([]))])',
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_000,
    });

    expect(prompt).toContain('Quality issues:');
    expect(prompt).toContain(
      '- control-action-and-binding in root: Form-control cannot have both action and a writable $binding. Use $binding for form state, or action for persisted updates.',
    );
    expect(prompt).toContain(
      '- Repair hint: Pick one of: (a) keep `$binding` and remove `action`, OR (b) keep `action` and replace the writable `$binding<…>` with a display-only literal/`item.field`.',
    );
  });

  it('keeps $lastChoice rules visible when repairing persisted choice controls', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'control-action-and-binding',
        message:
          'Form-control cannot have both action and a writable $binding. Use $binding for form state, or action for persisted updates.',
        source: 'quality',
        statementId: 'root',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Create a persisted filter control.',
      committedSource: 'root = AppShell([])',
      invalidSource: `savedFilter = Query("read_state", { path: "prefs.filter" }, "all")
saveFilter = Mutation("write_state", {
  path: "prefs.filter",
  value: $lastChoice
})

root = AppShell([
  Screen("main", "Main", [
    Select("filter", "Filter", $filter, filterOptions, null, [], Action([@Run(saveFilter), @Run(savedFilter)]))
  ])
])`,
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_500,
    });

    expect(prompt).toContain(
      'When RadioGroup or Select runs in action mode, the runtime writes the newly selected option to `$lastChoice` before the action runs.',
    );
    expect(prompt).toContain(
      'Use `$lastChoice` only inside Select/RadioGroup action-mode flows or the top-level Mutation(...) / Query(...) statements those actions run.',
    );
    expect(prompt).toContain(
      'If a RadioGroup/Select repair removes `action`, also remove or rewrite any top-level Mutation(...) / Query(...) helpers that still reference `$lastChoice`. Otherwise the repaired draft will still fail quality checks.',
    );
  });

  it('adds targeted hints for bare RadioGroup/Select option arrays', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'quality-options-shape',
        context: {
          groupId: 'questions',
          invalidValues: ['Never gonna give you up', 'Never gonna let you down'],
        },
        message: 'RadioGroup/Select options must be `{label, value}` objects, not bare strings or numbers.',
        source: 'quality',
        statementId: 'questions',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Create a Rickroll-themed quiz.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'questions = [{ prompt: "Lyric", options: ["Never gonna give you up", "Never gonna let you down"] }]\nroot = AppShell([])',
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_000,
    });

    expect(prompt).toContain('Targeted repair hints:');
    expect(prompt).toContain(
      'In `questions`, convert invalid option values "Never gonna give you up", "Never gonna let you down" into objects with both label and value.',
    );
    expect(prompt).toContain('Wrap each option in `{ label: "...", value: "..." }`.');
    expect(prompt).toContain(
      'quality-options-shape in questions: RadioGroup/Select options must be `{label, value}` objects, not bare strings or numbers.',
    );
  });

  it('surfaces screen nesting as an explicit repair rule', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'screen-inside-screen',
        message:
          'Screen cannot contain another Screen at any depth. Keep Screens as top-level AppShell children and use Group for local layout inside a screen.',
        source: 'quality',
        statementId: 'root',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Build a two-step quiz.',
      committedSource: 'root = AppShell([Screen("main", "Main", [])])',
      invalidSource: 'root = AppShell([Screen("main", "Main", [Screen("nested", "Nested", [])])])',
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_000,
    });

    expect(prompt).toContain(
      'Screen never contains another Screen at any depth. Keep Screens as top-level AppShell children and use Group for local layout inside a screen.',
    );
    expect(prompt).toContain('Targeted repair hints:');
  });

  it('uses append_item in the todo repair hint', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'quality-missing-todo-controls',
        message: 'Todo request did not generate required todo controls.',
        source: 'quality',
        statementId: 'root',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Create a todo list.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([])',
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_000,
    });

    expect(prompt).toContain('Targeted repair hints:');
    expect(prompt).toContain(
      'For a todo request, include an input for the draft value, a persisted `Query("read_state", ...)`, an `append_item` mutation for plain-object todo rows, a button action that runs the mutation and then the query, and a repeated list rendered through `@Each(...)` + `Repeater(...)`.',
    );
    expect(prompt).toContain('Example for interactive todo pattern:');
    expect(prompt).toContain('OK: addItem = Mutation("append_item", { path: "app.items", value: { title: $draft, completed: false } })');
    expect(prompt).not.toContain('an `append_state` mutation');
    expect(prompt).toMatchSnapshot();
  });

  it('lists every missing state declaration before the draft and keeps the full hint list stable', () => {
    const issues = buildUndefinedStateReferenceIssues(20);
    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Build a 20-question quiz.',
      committedSource: 'root = AppShell([])',
      invalidSource: buildHugeQuizDraft(20),
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 9_544,
    });

    expect(prompt.indexOf('Targeted repair hints:')).toBeLessThan(prompt.indexOf('Model draft to repair:'));

    for (let questionNumber = 1; questionNumber <= 20; questionNumber += 1) {
      expect(prompt).toContain(`$q${questionNumber} = ""`);
    }

    expect(prompt).toMatchSnapshot();
  });

  it('truncates the draft before issues and hints when the repair prompt is over budget', () => {
    const issues = buildUndefinedStateReferenceIssues(20);
    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Build a 20-question quiz.',
      committedSource: 'root = AppShell([])',
      invalidSource: buildHugeQuizDraft(20),
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 7_500,
    });

    expect(prompt).toContain('Quality issues:');
    expect(prompt).toContain('Targeted repair hints:');
    expect(prompt).toContain('$q20 = ""');
    expect(prompt).not.toContain('END-OF-DRAFT');
    expect(prompt).toContain('…');
    expect(prompt).toMatchSnapshot();
  });

  it('keeps all 20 missing state declarations visible at the production repair prompt budget', () => {
    const issues = buildUndefinedStateReferenceIssues(20);
    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Build a 20-question quiz.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([])',
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_096,
    });

    expect(prompt).toContain('Targeted repair hints:');

    for (let questionNumber = 1; questionNumber <= 20; questionNumber += 1) {
      expect(prompt).toContain(`$q${questionNumber} = ""`);
    }
  });

  it('builds missing-state hints from structured issue context instead of message text', () => {
    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Build a filtered list.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Text($filter, "body", "start")])',
      issues: [
        {
          code: 'undefined-state-reference',
          context: {
            exampleInitializer: '"all"',
            refName: '$filter',
          },
          message: 'Missing local state declaration.',
          source: 'quality',
          statementId: 'root',
        },
      ],
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_500,
    });

    expect(prompt).toContain('Add every missing `$var` before root.');
    expect(prompt).toContain('`$filter = "all"`');
  });

  it('dedupes repeated undefined-state issues by variable name and annotates the repeat count', () => {
    const repeatedIssues: PromptBuildValidationIssue[] = Array.from({ length: 5 }, () => ({
      code: 'undefined-state-reference',
      context: {
        exampleInitializer: '0',
        refName: '$score',
      },
      message: 'State reference `$score` is missing a top-level declaration with a literal initial value. For example, add `$score = 0`.',
      source: 'quality',
      statementId: 'results',
    }));

    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Build a score screen.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Text("Score", "body", "start"), Text($score, "body", "start")])',
      issues: repeatedIssues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_500,
    });

    expect(prompt).toContain('undefined-state-reference in results: State reference `$score` is missing a top-level declaration with a literal initial value. For example, add `$score = 0`. [reported 5 times]');
    expect(prompt.match(/undefined-state-reference in results:/g)).toHaveLength(1);
  });

  it('keeps parser repair framed as syntax repair instead of quality repair', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'unresolved-reference',
        message: 'This statement was referenced but never defined in the final source.',
        source: 'parser',
        statementId: 'items',
      },
    ];

    const prompt = buildOpenUiRepairPrompt({
      userPrompt: 'Create a todo list.',
      committedSource: 'root = AppShell([])',
      invalidSource: 'root = AppShell([Button("add", "Add", "default", Action([@Run(items)]))])',
      issues,
      attemptNumber: 1,
      maxRepairAttempts: 1,
      promptMaxChars: 4_000,
    });

    expect(prompt).not.toContain('The draft is syntactically valid but fails a product-quality check.');
    expect(prompt).toContain('Carry forward the intended changes from the invalid model draft only when they can be expressed as valid OpenUI.');
    expect(prompt).toContain('Invalid model draft:');
    expect(prompt).toContain('Validation issues:');
  });
});
