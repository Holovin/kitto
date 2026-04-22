import { describe, expect, it } from 'vitest';
import {
  detectPromptAwareQualityIssues,
  detectPromptAwareQualityWarnings,
} from '../../prompts/openui.js';

describe('detectPromptAwareQualityWarnings', () => {
  it('warns when a simple todo request generates multiple screens', () => {
    const warnings = detectPromptAwareQualityWarnings(
      `root = AppShell([
  Screen("main", "Todo list", [
    Text("Tasks", "title", "start")
  ]),
  Screen("details", "Details", [
    Text("Task details", "body", "start")
  ], false),
  Screen("settings", "Settings", [
    Text("Preferences", "body", "start")
  ], false)
])`,
      'Create a todo list.',
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-too-many-screens',
          message: 'Simple request generated multiple screens.',
          source: 'quality',
        }),
      ]),
    );
  });

  it('warns when theme styling was added without being requested', () => {
    const warnings = detectPromptAwareQualityWarnings(
      `$currentTheme = "dark"
root = AppShell([
  Screen("main", "Todo list", [
    Text("Theme preview", "body", "start")
  ])
], $currentTheme == "dark" ? { mainColor: "#111827", contrastColor: "#F9FAFB" } : { mainColor: "#FFFFFF", contrastColor: "#111827" })`,
      'Create a todo list.',
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-unrequested-theme',
          message: 'Theme styling was added even though not requested.',
          source: 'quality',
        }),
      ]),
    );
  });
});

describe('detectPromptAwareQualityIssues', () => {
  it('marks missing todo controls as blocking for a simple todo intent', () => {
    const issues = detectPromptAwareQualityIssues(
      `root = AppShell([
  Screen("main", "Todo list", [
    Text("Todo list", "title", "start"),
    Text("Start by describing your tasks here.", "body", "start")
  ])
])`,
      'Create a todo list.',
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-missing-todo-controls',
          message: 'Todo request did not generate required todo controls.',
          severity: 'blocking-quality',
          source: 'quality',
        }),
      ]),
    );
  });

  it('keeps missing todo controls as a soft warning when anti-keywords make the prompt non-simple', () => {
    const issues = detectPromptAwareQualityIssues(
      `root = AppShell([
  Screen("main", "CRM", [
    Text("CRM overview", "title", "start")
  ])
])`,
      'Create a CRM with a task list module.',
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-missing-todo-controls',
          message: 'Todo request did not generate required todo controls.',
          severity: 'soft-warning',
          source: 'quality',
        }),
      ]),
    );
  });

  it('still evaluates prompt-aware issues after applying auto-fixable source rewrites', () => {
    const issues = detectPromptAwareQualityIssues(
      `root = AppShell([
  Screen("main", "Todo list")
])`,
      'Create a todo list.',
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-missing-todo-controls',
          severity: 'blocking-quality',
          source: 'quality',
        }),
      ]),
    );
  });

  it('marks bare top-level string option arrays for RadioGroup and Select as blocking quality', () => {
    const issues = detectPromptAwareQualityIssues(
      `$answer = ""
$filter = ""
rickrollOptions = [
  "Never gonna give you up",
  "Never gonna let you down"
]

root = AppShell([
  Screen("main", "Rickroll quiz", [
    RadioGroup("answer", "Pick a lyric", $answer, rickrollOptions),
    Select("filter", "Filter", $filter, rickrollOptions)
  ])
])`,
      'Create a Rickroll-themed quiz.',
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-options-shape',
          message: 'RadioGroup/Select options must be `{label, value}` objects, not bare strings or numbers.',
          severity: 'blocking-quality',
          source: 'quality',
          statementId: 'rickrollOptions',
        }),
      ]),
    );
  });

  it('marks collection-backed string option arrays as blocking quality and points to the declaration', () => {
    const issues = detectPromptAwareQualityIssues(
      `$currentQuestion = 0
$answer = ""
questions = [
  {
    prompt: "Which lyric starts the chorus?",
    options: [
      "Never gonna give you up",
      "Never gonna let you down"
    ]
  }
]

root = AppShell([
  Screen("main", "Rickroll quiz", [
    RadioGroup("answer", questions[$currentQuestion].prompt, $answer, questions[$currentQuestion].options)
  ])
])`,
      'Create a Rickroll-themed quiz.',
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-options-shape',
          message: expect.stringContaining('Collection `questions` contains `.options` arrays'),
          severity: 'blocking-quality',
          source: 'quality',
          statementId: 'questions',
        }),
      ]),
    );
  });

  it('marks missing random refresh as blocking when the prompt requests randomness', () => {
    const issues = detectPromptAwareQualityIssues(
      `rollDice = Mutation("write_computed_state", {
  path: "app.roll",
  op: "random_int",
  options: { min: 1, max: 6 },
  returnType: "number"
})
rollValue = Query("read_state", { path: "app.roll" }, null)

root = AppShell([
  Screen("main", "Dice", [
    Button("roll", "Roll", "default", Action([@Run(rollDice)]), false),
    Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")
  ])
])`,
      'Create a random dice roller.',
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-random-result-not-visible',
          severity: 'blocking-quality',
          source: 'quality',
        }),
      ]),
    );
  });

  it('does not mark a valid random refresh recipe as blocking', () => {
    const issues = detectPromptAwareQualityIssues(
      `rollDice = Mutation("write_computed_state", {
  path: "app.roll",
  op: "random_int",
  options: { min: 1, max: 6 },
  returnType: "number"
})
rollValue = Query("read_state", { path: "app.roll" }, null)

root = AppShell([
  Screen("main", "Dice", [
    Button("roll", "Roll", "default", Action([@Run(rollDice), @Run(rollValue)]), false),
    Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")
  ])
])`,
      'Create a random dice roller.',
    );

    expect(issues.find((issue) => issue.code === 'quality-random-result-not-visible')).toBeUndefined();
  });

  it('marks theme-switch requests as blocking when theme state does not drive container appearance', () => {
    const issues = detectPromptAwareQualityIssues(
      `$currentTheme = "light"
appTheme = { mainColor: "#FFFFFF", contrastColor: "#111827" }

root = AppShell([
  Screen("main", "Theme demo", [
    Button("theme-light", "Light", "default", Action([@Set($currentTheme, "light")]), false),
    Button("theme-dark", "Dark", "secondary", Action([@Set($currentTheme, "dark")]), false),
    Text("Current theme: " + $currentTheme, "body", "start")
  ])
], appTheme)`,
      'Add dark mode with a light and dark theme switch.',
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-theme-state-not-applied',
          severity: 'blocking-quality',
          source: 'quality',
        }),
      ]),
    );
  });

  it('does not mark a valid theme appearance binding as blocking', () => {
    const issues = detectPromptAwareQualityIssues(
      `$currentTheme = "light"
appTheme = $currentTheme == "dark"
  ? { mainColor: "#111827", contrastColor: "#F9FAFB" }
  : { mainColor: "#F9FAFB", contrastColor: "#111827" }

root = AppShell([
  Screen("main", "Theme demo", [
    Button("theme-light", "Light", "default", Action([@Set($currentTheme, "light")]), false),
    Button("theme-dark", "Dark", "secondary", Action([@Set($currentTheme, "dark")]), false)
  ])
], appTheme)`,
      'Add dark mode with a light and dark theme switch.',
    );

    expect(issues.find((issue) => issue.code === 'quality-theme-state-not-applied')).toBeUndefined();
  });
});
