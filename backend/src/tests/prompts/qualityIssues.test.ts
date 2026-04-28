import { describe, expect, it } from 'vitest';
import {
  detectPromptAwareQualityIssues,
  detectPromptAwareQualityWarnings,
} from '#backend/prompts/openui.js';

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

  it('does not treat theme text or state names as theme styling by themselves', () => {
    const warnings = detectPromptAwareQualityWarnings(
      `$currentTheme = "dark"
root = AppShell([
  Screen("main", "Status", [
    Text("Current theme: " + $currentTheme, "body", "start")
  ])
])`,
      'Create a status display.',
    );

    expect(warnings.find((warning) => warning.code === 'quality-unrequested-theme')).toBeUndefined();
  });

  it('does not warn about existing theme styling when the latest request edits app content', () => {
    const currentSource = `$currentTheme = "dark"
root = AppShell([
  Screen("main", "Todo list", [
    Text("Theme preview", "body", "start")
  ])
], $currentTheme == "dark" ? { mainColor: "#111827", contrastColor: "#F9FAFB" } : { mainColor: "#FFFFFF", contrastColor: "#111827" })`;

    const warnings = detectPromptAwareQualityWarnings(
      `$currentTheme = "dark"
root = AppShell([
  Screen("main", "Task list", [
    Text("Renamed heading", "title", "start")
  ])
], $currentTheme == "dark" ? { mainColor: "#111827", contrastColor: "#F9FAFB" } : { mainColor: "#FFFFFF", contrastColor: "#111827" })`,
      'Rename the heading.',
      currentSource,
    );

    expect(warnings.find((warning) => warning.code === 'quality-unrequested-theme')).toBeUndefined();
  });

  it('warns when filtering was added without being requested', () => {
    const warnings = detectPromptAwareQualityWarnings(
      `tasks = [
  { title: "Design landing page", done: false },
  { title: "Write onboarding copy", done: true }
]
filteredTasks = @Filter(tasks, "done", "==", false)

root = AppShell([
  Screen("main", "Task dashboard", [
    Repeater(@Each(filteredTasks, "task", Group(task.title, "vertical", [
      Text(task.done ? "Done" : "Open", "body", "start")
    ])), "No tasks match.")
  ])
])`,
      'Create a task dashboard.',
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-unrequested-filter',
          message: 'Filtering was added even though not requested.',
          source: 'quality',
        }),
      ]),
    );
  });

  it('does not warn about unrequested filters when the prompt explicitly asks for filtering', () => {
    const warnings = detectPromptAwareQualityWarnings(
      `$filterStatus = "all"
tasks = [
  { title: "Design landing page", done: false },
  { title: "Write onboarding copy", done: true }
]
filteredTasks = $filterStatus == "all" ? tasks : ($filterStatus == "open" ? @Filter(tasks, "done", "==", false) : @Filter(tasks, "done", "==", true))

root = AppShell([
  Screen("main", "Task dashboard", [
    Select("status-filter", "Show", $filterStatus, [
      { label: "All", value: "all" },
      { label: "Open", value: "open" },
      { label: "Done", value: "done" }
    ]),
    Repeater(@Each(filteredTasks, "task", Group(task.title, "vertical", [
      Text(task.done ? "Done" : "Open", "body", "start")
    ])), "No tasks match.")
  ])
])`,
      'Create a complex app with two screens, filtering, a random number button, validation, and a dark theme.',
    );

    expect(warnings.find((warning) => warning.code === 'quality-unrequested-filter')).toBeUndefined();
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

  it('keeps task-list prompts with requested filters on the blocking todo path', () => {
    const issues = detectPromptAwareQualityIssues(
      `root = AppShell([
  Screen("main", "Tasks", [
    Text("Tasks", "title", "start")
  ])
])`,
      'Create a task list with completed status and a filter with All, Active and Completed.',
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

  it('marks todo rows with only completed text as missing required todo controls', () => {
    const issues = detectPromptAwareQualityIssues(
      `$draft = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_item", { path: "app.items", value: { title: $draft, completed: false } })
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "body", "start")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Input("draft", "Task", $draft, "New task"),
    Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == ""),
    Repeater(rows, "No tasks yet.")
  ])
])`,
      'Create a todo list.',
    );

    expect(issues.find((issue) => issue.code === 'quality-missing-todo-controls')).toEqual(
      expect.objectContaining({
        code: 'quality-missing-todo-controls',
        severity: 'blocking-quality',
        source: 'quality',
      }),
    );
  });

  it('accepts todo rows with an action-mode persisted Checkbox toggle and query refresh', () => {
    const issues = detectPromptAwareQualityIssues(
      `$draft = ""
$targetItemId = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_item", { path: "app.items", value: { title: $draft, completed: false } })
toggleItem = Mutation("toggle_item_field", { path: "app.items", idField: "id", id: $targetItemId, field: "completed" })
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Input("draft", "Task", $draft, "New task"),
    Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == ""),
    Repeater(rows, "No tasks yet.")
  ])
])`,
      'Create a todo list.',
    );

    expect(issues.find((issue) => issue.code === 'quality-missing-todo-controls')).toBeUndefined();
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
          context: {
            groupId: 'rickrollOptions',
            invalidValues: ['Never gonna give you up', 'Never gonna let you down'],
          },
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
          context: {
            groupId: 'questions',
            invalidValues: ['Never gonna give you up', 'Never gonna let you down'],
          },
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

  it('marks ungated multi-screen output as blocking when the prompt asks for screens', () => {
    const issues = detectPromptAwareQualityIssues(
      `root = AppShell([
  Screen("browse", "Browse", [
    Text("Browse items", "title", "start")
  ]),
  Screen("form", "Form", [
    Text("Create an item", "title", "start")
  ])
])`,
      'Create a complex app with two screens.',
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-missing-screen-flow',
          message: 'Multi-screen request generated multiple always-visible screens or omitted $currentScreen navigation.',
          severity: 'blocking-quality',
          source: 'quality',
        }),
      ]),
    );
  });

  it('does not mark current-screen navigation as blocking for multi-screen requests', () => {
    const issues = detectPromptAwareQualityIssues(
      `$currentScreen = "browse"
root = AppShell([
  Screen("browse", "Browse", [
    Button("go-form", "Form", "default", Action([@Set($currentScreen, "form")]), false)
  ], $currentScreen == "browse"),
  Screen("form", "Form", [
    Button("go-browse", "Back", "secondary", Action([@Set($currentScreen, "browse")]), false)
  ], $currentScreen == "form")
])`,
      'Create a complex app with two screens.',
    );

    expect(issues.find((issue) => issue.code === 'quality-missing-screen-flow')).toBeUndefined();
  });

  it('marks incomplete control showcases as blocking', () => {
    const issues = detectPromptAwareQualityIssues(
      `$name = ""
$notes = ""
$agree = false
$choice = ""
$status = ""
options = [{ label: "One", value: "one" }]

root = AppShell([
  Screen("main", "Controls", [
    Input("name", "Name", $name),
    TextArea("notes", "Notes", $notes),
    Checkbox("agree", "Agree", $agree),
    RadioGroup("choice", "Choice", $choice, options),
    Select("status", "Status", $status, options),
    Button("submit", "Submit", "default", Action([]), false)
  ])
])`,
      'Build an app with every control you know.',
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-missing-control-showcase-components',
          context: { missingComponents: ['Link'] },
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

  it('does not warn that compute tooling is unrequested for roll and dice prompts', () => {
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
      'Roll a dice.',
    );

    expect(issues.find((issue) => issue.code === 'quality-unrequested-compute')).toBeUndefined();
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
