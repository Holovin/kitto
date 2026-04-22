import { describe, expect, it } from 'vitest';
import { detectOpenUiQualityIssues, detectOpenUiQualityWarnings } from '../../prompts/openui.js';

describe('detectOpenUiQualityWarnings', () => {
  it('warns when a simple todo request generates multiple screens', () => {
    const warnings = detectOpenUiQualityWarnings(
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
    const warnings = detectOpenUiQualityWarnings(
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

describe('detectOpenUiQualityIssues', () => {
  it('marks missing todo controls as blocking for a simple todo intent', () => {
    const issues = detectOpenUiQualityIssues(
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
    const issues = detectOpenUiQualityIssues(
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
    const issues = detectOpenUiQualityIssues(
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

  it('marks missing random refresh as blocking when the prompt requests randomness', () => {
    const issues = detectOpenUiQualityIssues(
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
    const issues = detectOpenUiQualityIssues(
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
    const issues = detectOpenUiQualityIssues(
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
    const issues = detectOpenUiQualityIssues(
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
